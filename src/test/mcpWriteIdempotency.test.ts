// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  createIdempotentWriter,
  hashMcpWriteInput,
  McpWriteNotAppliedError,
  McpWriteOperationAmbiguousError,
  McpWriteOperationMismatchError,
  McpWriteOperationPendingError,
  McpWriteOperationRepository,
  McpWriteOperationValidationError,
  normalizeMcpWriteInput,
} from '../../functions/_lib/mcpWriteIdempotency'

type StoredOperation = {
  profile_id: string
  operation_id: string
  input_hash: string
  state: 'pending' | 'completed'
  result_json: string | null
  created_at: string
  updated_at: string
}

class FakeD1 {
  readonly rows = new Map<string, StoredOperation>()

  prepare(sql: string) {
    return {
      bind: (...values: unknown[]) => ({
        first: async <T>() => this.first(sql, values) as T | null,
        run: async () => this.run(sql, values),
      }),
    }
  }

  private key(profileId: string, operationId: string) {
    return `${profileId}:${operationId}`
  }

  private first(sql: string, values: unknown[]) {
    if (!sql.includes('FROM mcp_write_operations')) {
      throw new Error(`Unexpected query: ${sql}`)
    }
    const [profileId, operationId] = values as [string, string]
    const row = this.rows.get(this.key(profileId, operationId))
    return row
      ? {
          input_hash: row.input_hash,
          state: row.state,
          result_json: row.result_json,
        }
      : null
  }

  private run(sql: string, values: unknown[]) {
    if (sql.includes('INSERT INTO mcp_write_operations')) {
      const [profileId, operationId, inputHash, createdAt, updatedAt] =
        values as [string, string, string, string, string]
      const key = this.key(profileId, operationId)
      if (this.rows.has(key)) return { meta: { changes: 0 } }
      this.rows.set(key, {
        profile_id: profileId,
        operation_id: operationId,
        input_hash: inputHash,
        state: 'pending',
        result_json: null,
        created_at: createdAt,
        updated_at: updatedAt,
      })
      return { meta: { changes: 1 } }
    }

    if (sql.includes('UPDATE mcp_write_operations')) {
      const [resultJson, updatedAt, profileId, operationId, inputHash] =
        values as [string, string, string, string, string]
      const key = this.key(profileId, operationId)
      const row = this.rows.get(key)
      if (
        !row ||
        row.input_hash !== inputHash ||
        row.state !== 'pending'
      ) {
        return { meta: { changes: 0 } }
      }
      this.rows.set(key, {
        ...row,
        state: 'completed',
        result_json: resultJson,
        updated_at: updatedAt,
      })
      return { meta: { changes: 1 } }
    }

    if (sql.includes('DELETE FROM mcp_write_operations')) {
      const [profileId, operationId, inputHash] = values as [
        string,
        string,
        string,
      ]
      const key = this.key(profileId, operationId)
      const row = this.rows.get(key)
      if (
        !row ||
        row.input_hash !== inputHash ||
        row.state !== 'pending'
      ) {
        return { meta: { changes: 0 } }
      }
      this.rows.delete(key)
      return { meta: { changes: 1 } }
    }

    throw new Error(`Unexpected query: ${sql}`)
  }
}

const PROFILE_ID = '11111111-1111-4111-8111-111111111111'
const baseInput = {
  day_id: '2026-07-16',
  content_md: 'Added note',
  operation_id: 'operation-1',
} as const

const createRepository = (db = new FakeD1()) => ({
  db,
  repository: new McpWriteOperationRepository(
    db as unknown as D1Database,
    () => new Date('2026-07-16T08:00:00.000Z'),
  ),
})

describe('MCP write idempotency', () => {
  it('claims the first call, stores a compact result, and replays it', async () => {
    const { db, repository } = createRepository()
    const writer = vi.fn(async () => ({
      day_id: '2026-07-16',
      content_chars: 10,
      position: 'append' as const,
      source: { provider: 'dropbox', rev: 'rev-2' },
    }))
    const write = createIdempotentWriter(repository, PROFILE_ID, writer)

    const first = await write(baseInput)
    const replay = await write(baseInput)

    expect(first).toEqual(replay)
    expect(writer).toHaveBeenCalledOnce()
    const stored = [...db.rows.values()][0]
    expect(stored).toMatchObject({
      profile_id: PROFILE_ID,
      operation_id: 'operation-1',
      state: 'completed',
    })
    expect(stored?.input_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(stored?.result_json).toContain('"content_chars":10')
    expect(stored?.result_json).not.toContain('Added note')
  })

  it('normalizes equivalent additive input before hashing and writing', async () => {
    const normalized = normalizeMcpWriteInput({
      ...baseInput,
      content_md: '\r\nAdded note\r\n\r\n',
    })

    expect(normalized).toEqual({
      ...baseInput,
      content_md: 'Added note',
      position: 'append',
    })
    await expect(hashMcpWriteInput(normalized)).resolves.toMatch(/^[0-9a-f]{64}$/)
  })

  it('rejects reuse of an operation ID with different input', async () => {
    const { repository } = createRepository()
    const writer = vi.fn(async () => ({ status: 'written' }))
    const write = createIdempotentWriter(repository, PROFILE_ID, writer)

    await write(baseInput)

    await expect(
      write({ ...baseInput, content_md: 'Different note' }),
    ).rejects.toBeInstanceOf(McpWriteOperationMismatchError)
    expect(writer).toHaveBeenCalledOnce()
  })

  it('treats an existing pending claim as ambiguous without calling the writer', async () => {
    const { repository } = createRepository()
    const normalized = normalizeMcpWriteInput(baseInput)
    const hash = await hashMcpWriteInput(normalized)
    await repository.claim(PROFILE_ID, baseInput.operation_id, hash)
    const writer = vi.fn(async () => ({ status: 'written' }))
    const write = createIdempotentWriter(repository, PROFILE_ID, writer)

    await expect(write(baseInput)).rejects.toBeInstanceOf(
      McpWriteOperationPendingError,
    )
    expect(writer).not.toHaveBeenCalled()
  })

  it('allows a safe retry only when the writer guarantees nothing was applied', async () => {
    const { db, repository } = createRepository()
    const writer = vi
      .fn()
      .mockRejectedValueOnce(
        new McpWriteNotAppliedError('Upload was not started.'),
      )
      .mockResolvedValueOnce({ status: 'written' })
    const write = createIdempotentWriter(repository, PROFILE_ID, writer)

    await expect(write(baseInput)).rejects.toThrow('Upload was not started.')
    expect(db.rows.size).toBe(0)

    await expect(write(baseInput)).resolves.toEqual({ status: 'written' })
    expect(writer).toHaveBeenCalledTimes(2)
  })

  it('keeps an ordinary writer failure pending to prevent an unsafe retry', async () => {
    const { db, repository } = createRepository()
    const writer = vi.fn(async () => {
      throw new Error('Connection ended after upload.')
    })
    const write = createIdempotentWriter(repository, PROFILE_ID, writer)

    await expect(write(baseInput)).rejects.toBeInstanceOf(
      McpWriteOperationAmbiguousError,
    )
    expect([...db.rows.values()][0]?.state).toBe('pending')
    await expect(write(baseInput)).rejects.toBeInstanceOf(
      McpWriteOperationPendingError,
    )
    expect(writer).toHaveBeenCalledOnce()
  })

  it('never persists a provider result that still contains a note body', async () => {
    const { db, repository } = createRepository()
    const writer = vi.fn(async () => ({
      day: {
        dayId: '2026-07-16',
        contentMd: 'Existing notes plus Added note',
      },
      status: 'written',
    }))
    const write = createIdempotentWriter(repository, PROFILE_ID, writer)

    await expect(write(baseInput)).rejects.toBeInstanceOf(
      McpWriteOperationAmbiguousError,
    )
    const stored = [...db.rows.values()][0]
    expect(stored).toMatchObject({ state: 'pending', result_json: null })
    expect(JSON.stringify(stored)).not.toContain('Existing notes')
  })

  it('atomically permits only one concurrent provider call', async () => {
    const { repository } = createRepository()
    let resolveWriter!: (value: { status: string }) => void
    const writer = vi.fn(
      () =>
        new Promise<{ status: string }>((resolve) => {
          resolveWriter = resolve
        }),
    )
    const write = createIdempotentWriter(repository, PROFILE_ID, writer)

    const first = write(baseInput)
    await vi.waitFor(() => expect(writer).toHaveBeenCalledOnce())
    await expect(write(baseInput)).rejects.toBeInstanceOf(
      McpWriteOperationPendingError,
    )
    resolveWriter({ status: 'written' })

    await expect(first).resolves.toEqual({ status: 'written' })
    expect(writer).toHaveBeenCalledOnce()
  })

  it('conservatively validates operation IDs before claiming', async () => {
    const { repository } = createRepository()
    const writer = vi.fn(async () => ({ status: 'written' }))
    const write = createIdempotentWriter(repository, PROFILE_ID, writer)

    await expect(
      write({ ...baseInput, operation_id: 'bad id' }),
    ).rejects.toBeInstanceOf(McpWriteOperationValidationError)
    await expect(
      write({ ...baseInput, operation_id: 'a'.repeat(129) }),
    ).rejects.toBeInstanceOf(McpWriteOperationValidationError)
    expect(writer).not.toHaveBeenCalled()
  })
})
