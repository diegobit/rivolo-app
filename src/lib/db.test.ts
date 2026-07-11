import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  initSqlJs: vi.fn(),
  get: vi.fn(),
}))

vi.mock('sql.js', () => ({ default: mocks.initSqlJs }))
vi.mock('sql.js/dist/sql-wasm.wasm?url', () => ({ default: 'test-wasm-url' }))
vi.mock('idb-keyval', () => ({ get: mocks.get, set: vi.fn() }))
vi.mock('./tabSyncCoordinator', () => ({
  assertDatabaseWritable: vi.fn(),
  beginDatabaseSnapshotLoad: vi.fn(),
  broadcastDatabasePersisted: vi.fn(),
}))

class FakeDatabase {
  run() {}
}

describe('getDatabase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mocks.get.mockResolvedValue(null)
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
