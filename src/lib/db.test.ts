import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  initSqlJs: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  assertDatabaseWritable: vi.fn(),
}))

vi.mock('sql.js', () => ({ default: mocks.initSqlJs }))
vi.mock('sql.js/dist/sql-wasm.wasm?url', () => ({ default: 'test-wasm-url' }))
vi.mock('idb-keyval', () => ({ get: mocks.get, set: mocks.set }))
vi.mock('./tabSyncCoordinator', () => ({
  assertDatabaseWritable: mocks.assertDatabaseWritable,
  beginDatabaseSnapshotLoad: vi.fn(),
  broadcastDatabasePersisted: vi.fn(),
}))

class FakeDatabase {
  run() {}
  export() {
    return new Uint8Array()
  }
}

describe('getDatabase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mocks.get.mockResolvedValue(null)
    mocks.set.mockResolvedValue(undefined)
  })

  it('resets the cached open so a later call can retry and succeed after a failed open', async () => {
    let attempt = 0
    mocks.initSqlJs.mockResolvedValue({
      Database: class {
        constructor() {
          attempt += 1
          if (attempt === 1) {
            throw new Error('corrupt database bytes')
          }
          return new FakeDatabase()
        }
      },
    })

    const { getDatabase } = await import('./db')

    await expect(getDatabase()).rejects.toThrow('corrupt database bytes')

    const db = await getDatabase()
    expect(db).toBeInstanceOf(FakeDatabase)
    expect(attempt).toBe(2)
  })

  it('resets the cached sql.js engine so a later call can retry after an init failure', async () => {
    mocks.initSqlJs.mockRejectedValueOnce(new Error('wasm load failed'))
    mocks.initSqlJs.mockResolvedValueOnce({ Database: FakeDatabase })

    const { getDatabase } = await import('./db')

    await expect(getDatabase()).rejects.toThrow('wasm load failed')

    const db = await getDatabase()
    expect(db).toBeInstanceOf(FakeDatabase)
    expect(mocks.initSqlJs).toHaveBeenCalledTimes(2)
  })
})

describe('persistDatabase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mocks.set.mockResolvedValue(undefined)
  })

  it('records a persist-failure message when the underlying storage write rejects', async () => {
    mocks.set.mockRejectedValueOnce(new Error('quota exceeded'))

    const { persistDatabase, getDatabasePersistFailureSnapshot } = await import('./db')

    await expect(persistDatabase(new FakeDatabase() as never)).rejects.toThrow()

    expect(getDatabasePersistFailureSnapshot()).toBe(
      'Your notes could not be saved on this device. Check available storage and try again.',
    )
  })

  it('clears a previous persist-failure message once a later save succeeds', async () => {
    mocks.set.mockRejectedValueOnce(new Error('quota exceeded'))

    const { persistDatabase, getDatabasePersistFailureSnapshot } = await import('./db')

    await expect(persistDatabase(new FakeDatabase() as never)).rejects.toThrow()
    expect(getDatabasePersistFailureSnapshot()).not.toBeNull()

    mocks.set.mockResolvedValueOnce(undefined)
    await persistDatabase(new FakeDatabase() as never)

    expect(getDatabasePersistFailureSnapshot()).toBeNull()
  })

  it('notifies subscribers when the persist-failure state changes', async () => {
    mocks.set.mockRejectedValueOnce(new Error('quota exceeded'))

    const { persistDatabase, subscribeDatabasePersistFailure } = await import('./db')
    const listener = vi.fn()
    const unsubscribe = subscribeDatabasePersistFailure(listener)

    await expect(persistDatabase(new FakeDatabase() as never)).rejects.toThrow()

    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })
})
