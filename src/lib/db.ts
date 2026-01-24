type SqlValue = string | number | bigint | null

type WorkerRequestPayload =
  | { type: 'init' }
  | { type: 'run'; sql: string; params: SqlValue[] }
  | { type: 'queryAll'; sql: string; params: SqlValue[] }
  | { type: 'isFtsAvailable' }
  | { type: 'upsertFts'; dayId: string; humanTitle: string; content: string }

type WorkerResponse = { id: number; result?: unknown; error?: string }

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

let worker: Worker | null = null
let nextRequestId = 1
const pendingRequests = new Map<number, PendingRequest>()

const rejectAll = (error: Error) => {
  pendingRequests.forEach((pending) => pending.reject(error))
  pendingRequests.clear()
}

const handleWorkerMessage = (event: MessageEvent<WorkerResponse>) => {
  const { id, result, error } = event.data
  const pending = pendingRequests.get(id)
  if (!pending) return
  pendingRequests.delete(id)

  if (error) {
    pending.reject(new Error(error))
    return
  }

  pending.resolve(result)
}

const ensureWorker = () => {
  if (!worker) {
    worker = new Worker(new URL('./sqliteWorker.ts', import.meta.url), { type: 'module' })
    worker.addEventListener('message', handleWorkerMessage)
    worker.addEventListener('messageerror', () => rejectAll(new Error('SQLite worker message error.')))
    worker.addEventListener('error', (event) =>
      rejectAll(new Error(event.message || 'SQLite worker error.')),
    )
  }

  return worker
}

const sendRequest = <T>(payload: WorkerRequestPayload) => {
  const requestId = nextRequestId++
  const workerInstance = ensureWorker()

  return new Promise<T>((resolve, reject) => {
    pendingRequests.set(requestId, {
      resolve: (value) => resolve(value as T),
      reject,
    })
    workerInstance.postMessage({ id: requestId, ...payload })
  })
}

export const getDatabase = async () => {
  await sendRequest<void>({ type: 'init' })
}

export const run = async (sql: string, params: SqlValue[] = []) => {
  await sendRequest<void>({ type: 'run', sql, params })
}

export const queryAll = async <T = Record<string, string | number | bigint | null>>(
  sql: string,
  params: SqlValue[] = [],
): Promise<T[]> => {
  return sendRequest<T[]>({ type: 'queryAll', sql, params })
}

export const queryOne = async <T = Record<string, string | number | bigint | null>>(
  sql: string,
  params: SqlValue[] = [],
): Promise<T | null> => {
  const rows = await queryAll<T>(sql, params)
  return rows[0] ?? null
}

export const isFtsAvailable = async () => {
  return sendRequest<boolean>({ type: 'isFtsAvailable' })
}

export const upsertFts = async (dayId: string, humanTitle: string, content: string) => {
  await sendRequest<void>({ type: 'upsertFts', dayId, humanTitle, content })
}
