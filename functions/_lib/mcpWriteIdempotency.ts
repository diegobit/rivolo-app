export type McpWritePosition = 'append' | 'prepend'

export type McpWriteInput = {
  day_id: string
  content_md: string
  operation_id: string
  position?: McpWritePosition
}

export type NormalizedMcpWriteInput = {
  day_id: string
  content_md: string
  operation_id: string
  position: McpWritePosition
}

type MaybePromise<T> = T | Promise<T>

type WriteOperationState = 'pending' | 'completed'

type WriteOperationRow = {
  input_hash: string
  state: WriteOperationState
  result_json: string | null
}

type WriteOperationClaim<Result> =
  | { status: 'claimed' }
  | { status: 'completed'; result: Result }
  | { status: 'pending' }
  | { status: 'mismatch' }

const PROFILE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/
const DAY_ID = /^(\d{4})-(\d{2})-(\d{2})$/
const INPUT_HASH = /^[0-9a-f]{64}$/
const MAX_CONTENT_CHARS = 20_000
export const MAX_COMPACT_WRITE_RESULT_BYTES = 16_384

export class McpWriteOperationValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'McpWriteOperationValidationError'
  }
}

export class McpWriteOperationMismatchError extends Error {
  constructor() {
    super(
      'operation_id was already used with different write input. Use a new operation_id.',
    )
    this.name = 'McpWriteOperationMismatchError'
  }
}

export class McpWriteOperationPendingError extends Error {
  constructor() {
    super(
      'Write operation is still pending or its outcome is ambiguous. Do not retry it with another operation_id; reconcile the provider state first.',
    )
    this.name = 'McpWriteOperationPendingError'
  }
}

/**
 * Writers may throw this only when they know the provider did not apply the write.
 * The idempotency claim is then released so the same operation can be retried safely.
 */
export class McpWriteNotAppliedError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'McpWriteNotAppliedError'
  }
}

export class McpWriteOperationAmbiguousError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'McpWriteOperationAmbiguousError'
  }
}

const validateProfileId = (profileId: string) => {
  if (!PROFILE_ID.test(profileId)) {
    throw new McpWriteOperationValidationError('profileId is invalid.')
  }
  return profileId
}

const validateOperationId = (operationId: string) => {
  if (!OPERATION_ID.test(operationId)) {
    throw new McpWriteOperationValidationError(
      'operation_id must be 8-128 ASCII letters, numbers, dots, underscores, colons, or hyphens.',
    )
  }
  return operationId
}

const validateDayId = (dayId: string) => {
  const match = DAY_ID.exec(dayId)
  if (!match) {
    throw new McpWriteOperationValidationError(
      'day_id must be a valid calendar date in YYYY-MM-DD format.',
    )
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new McpWriteOperationValidationError(
      'day_id must be a valid calendar date in YYYY-MM-DD format.',
    )
  }
  return dayId
}

const normalizeContent = (content: string) => {
  if (typeof content !== 'string' || content.length > MAX_CONTENT_CHARS) {
    throw new McpWriteOperationValidationError(
      `content_md must be ${MAX_CONTENT_CHARS} characters or fewer.`,
    )
  }

  const lines = content.replace(/\r\n?/g, '\n').split('\n')
  while (lines[0]?.trim() === '') lines.shift()
  while (lines.at(-1)?.trim() === '') lines.pop()
  const normalized = lines.join('\n')

  if (!normalized.trim()) {
    throw new McpWriteOperationValidationError('content_md must not be empty.')
  }
  return normalized
}

export const normalizeMcpWriteInput = (
  input: McpWriteInput,
): NormalizedMcpWriteInput => {
  const position = input.position ?? 'append'
  if (position !== 'append' && position !== 'prepend') {
    throw new McpWriteOperationValidationError(
      'position must be append or prepend.',
    )
  }

  return {
    day_id: validateDayId(input.day_id),
    content_md: normalizeContent(input.content_md),
    operation_id: validateOperationId(input.operation_id),
    position,
  }
}

export const hashMcpWriteInput = async (
  input: Pick<NormalizedMcpWriteInput, 'day_id' | 'content_md' | 'position'>,
) => {
  const encoded = new TextEncoder().encode(
    JSON.stringify([input.day_id, input.content_md, input.position]),
  )
  const digest = await crypto.subtle.digest('SHA-256', encoded)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

const parseCompletedResult = <Result>(resultJson: string | null): Result => {
  if (resultJson === null) {
    throw new Error('Completed MCP write operation has no stored result.')
  }
  return JSON.parse(resultJson) as Result
}

const assertNoNoteBodies = (value: unknown, seen = new Set<object>()) => {
  if (!value || typeof value !== 'object') return
  if (seen.has(value)) {
    throw new Error('MCP write result must be JSON serializable.')
  }
  seen.add(value)

  if (Array.isArray(value)) {
    value.forEach((item) => assertNoNoteBodies(item, seen))
    seen.delete(value)
    return
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === 'content_md' || key === 'contentMd') {
      throw new Error('MCP write result must not contain note bodies.')
    }
    assertNoNoteBodies(child, seen)
  }
  seen.delete(value)
}

const serializeCompactResult = (result: unknown) => {
  assertNoNoteBodies(result)
  let resultJson: string | undefined
  try {
    resultJson = JSON.stringify(result)
  } catch {
    throw new Error('MCP write result must be JSON serializable.')
  }
  if (resultJson === undefined) {
    throw new Error('MCP write result must be JSON serializable.')
  }
  if (new TextEncoder().encode(resultJson).byteLength > MAX_COMPACT_WRITE_RESULT_BYTES) {
    throw new Error(
      `MCP write result must be ${MAX_COMPACT_WRITE_RESULT_BYTES} bytes or fewer.`,
    )
  }
  return resultJson
}

/**
 * Persists only an input hash and a compact JSON result. Callers must keep results
 * metadata-only. Known note-body fields are rejected before persistence.
 */
export class McpWriteOperationRepository {
  constructor(
    private readonly db: D1Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async claim<Result>(
    profileId: string,
    operationId: string,
    inputHash: string,
  ): Promise<WriteOperationClaim<Result>> {
    const timestamp = this.now().toISOString()
    const validProfileId = validateProfileId(profileId)
    const validOperationId = validateOperationId(operationId)
    if (!INPUT_HASH.test(inputHash)) {
      throw new McpWriteOperationValidationError('inputHash is invalid.')
    }

    const inserted = await this.db
      .prepare(
        `INSERT INTO mcp_write_operations (
          profile_id,
          operation_id,
          input_hash,
          state,
          result_json,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, 'pending', NULL, ?, ?)
        ON CONFLICT(profile_id, operation_id) DO NOTHING`,
      )
      .bind(
        validProfileId,
        validOperationId,
        inputHash,
        timestamp,
        timestamp,
      )
      .run()

    if (inserted.meta.changes > 0) {
      return { status: 'claimed' }
    }

    const existing = await this.db
      .prepare(
        `SELECT input_hash, state, result_json
        FROM mcp_write_operations
        WHERE profile_id = ? AND operation_id = ?`,
      )
      .bind(validProfileId, validOperationId)
      .first<WriteOperationRow>()

    if (!existing) {
      throw new Error('MCP write operation claim could not be read.')
    }
    if (existing.input_hash !== inputHash) {
      return { status: 'mismatch' }
    }
    if (existing.state === 'pending') {
      return { status: 'pending' }
    }
    return {
      status: 'completed',
      result: parseCompletedResult<Result>(existing.result_json),
    }
  }

  async complete(
    profileId: string,
    operationId: string,
    inputHash: string,
    result: unknown,
  ) {
    const timestamp = this.now().toISOString()
    const resultJson = serializeCompactResult(result)
    const completed = await this.db
      .prepare(
        `UPDATE mcp_write_operations
        SET state = 'completed', result_json = ?, updated_at = ?
        WHERE profile_id = ?
          AND operation_id = ?
          AND input_hash = ?
          AND state = 'pending'`,
      )
      .bind(
        resultJson,
        timestamp,
        validateProfileId(profileId),
        validateOperationId(operationId),
        inputHash,
      )
      .run()

    if (completed.meta.changes !== 1) {
      throw new Error('MCP write operation could not be marked completed.')
    }
  }

  async release(
    profileId: string,
    operationId: string,
    inputHash: string,
  ) {
    const released = await this.db
      .prepare(
        `DELETE FROM mcp_write_operations
        WHERE profile_id = ?
          AND operation_id = ?
          AND input_hash = ?
          AND state = 'pending'`,
      )
      .bind(
        validateProfileId(profileId),
        validateOperationId(operationId),
        inputHash,
      )
      .run()

    if (released.meta.changes !== 1) {
      throw new Error('MCP write operation claim could not be released.')
    }
  }
}

export const createIdempotentWriter = <Result>(
  repository: McpWriteOperationRepository,
  profileId: string,
  writer: (input: NormalizedMcpWriteInput) => MaybePromise<Result>,
) => async (input: McpWriteInput): Promise<Result> => {
  const normalized = normalizeMcpWriteInput(input)
  const inputHash = await hashMcpWriteInput(normalized)
  const claim = await repository.claim<Result>(
    profileId,
    normalized.operation_id,
    inputHash,
  )

  if (claim.status === 'completed') return claim.result
  if (claim.status === 'mismatch') throw new McpWriteOperationMismatchError()
  if (claim.status === 'pending') throw new McpWriteOperationPendingError()

  let result: Result
  try {
    result = await writer(normalized)
  } catch (error) {
    if (error instanceof McpWriteNotAppliedError) {
      try {
        await repository.release(
          profileId,
          normalized.operation_id,
          inputHash,
        )
      } catch (releaseError) {
        throw new McpWriteOperationAmbiguousError(
          'The write was reported as not applied, but its idempotency claim could not be released. Reconcile the operation before retrying.',
          { cause: releaseError },
        )
      }
      throw error
    }

    throw new McpWriteOperationAmbiguousError(
      'The provider write outcome is unknown. The operation remains pending to prevent a duplicate append; reconcile it before retrying.',
      { cause: error },
    )
  }

  try {
    await repository.complete(
      profileId,
      normalized.operation_id,
      inputHash,
      result,
    )
  } catch (error) {
    throw new McpWriteOperationAmbiguousError(
      'The provider write succeeded, but its idempotency result could not be stored. The operation remains pending; reconcile it before retrying.',
      { cause: error },
    )
  }

  return result
}
