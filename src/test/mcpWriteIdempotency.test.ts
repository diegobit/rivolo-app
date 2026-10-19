// @vitest-environment node
import { SqliteD1, closeTestDatabases } from './helpers/d1'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

const PROFILE_ID = '11111111-1111-4111-8111-111111111111'
const baseInput = {
  day_id: '2026-07-16',
  content_md: 'Added note',
  operation_id: 'operation-1',
} as const

const createRepository = (db = new SqliteD1()) => {
  db.database.prepare(`
    INSERT INTO mcp_provider_profiles (
      profile_id, provider, provider_account_id, dropbox_path, time_zone,
      encrypted_refresh_token, created_at, updated_at
    ) VALUES (?, 'dropbox', 'account', '/inbox.md', 'UTC', 'encrypted', '2026-07-16', '2026-07-16')
  `).run(PROFILE_ID)
  return {
    db,
    repository: new McpWriteOperationRepository(
      db as unknown as D1Database,
      () => new Date('2026-07-16T08:00:00.000Z'),
    ),
  }
}

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
    const stored = db.get('SELECT * FROM mcp_write_operations')
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
    const { db, repository } = createRepository()
    const writer = vi.fn(async (input) => ({ status: 'written', content_chars: input.content_md.length }))
    const write = createIdempotentWriter(repository, PROFILE_ID, writer)
    const first = await write({ ...baseInput, content_md: '\r\nAdded note\r\n\r\n' })
    const replay = await write({ ...baseInput, position: 'append' })
    expect(replay).toEqual(first)
    expect(writer).toHaveBeenCalledExactlyOnceWith({ ...baseInput, position: 'append' })
    expect(db.all('SELECT * FROM mcp_write_operations')).toHaveLength(1)
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
    expect(db.all('SELECT * FROM mcp_write_operations').length).toBe(0)

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
    expect(db.get('SELECT * FROM mcp_write_operations')?.state).toBe('pending')
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
    const stored = db.get('SELECT * FROM mcp_write_operations')
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

afterEach(closeTestDatabases)
