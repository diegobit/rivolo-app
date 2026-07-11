import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  appendLineToDay,
  appendToDay,
  ensureDay,
  moveDay,
  replaceDays,
  saveDay,
} from './dayRepository'

const mocks = vi.hoisted(() => ({
  isFtsAvailable: vi.fn(),
  markSyncLocalDirty: vi.fn(),
  queryAll: vi.fn(),
  queryOne: vi.fn(),
  run: vi.fn(),
  runDatabaseTransaction: vi.fn(),
  upsertFts: vi.fn(),
}))

vi.mock('./db', () => ({
  isFtsAvailable: mocks.isFtsAvailable,
  queryAll: mocks.queryAll,
  queryOne: mocks.queryOne,
  run: mocks.run,
  runDatabaseTransaction: mocks.runDatabaseTransaction,
  upsertFts: mocks.upsertFts,
}))

vi.mock('./syncDirty', () => ({ markSyncLocalDirty: mocks.markSyncLocalDirty }))

describe('dayRepository day ID validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    ['ensureDay', () => ensureDay('2026-02-30')],
    ['saveDay', () => saveDay('2026-02-30', 'content')],
    ['moveDay source', () => moveDay('2026-02-30', '2026-03-01')],
    ['moveDay target', () => moveDay('2026-03-01', '2026-02-30')],
    ['appendLineToDay', () => appendLineToDay('2026-02-30', 'line')],
    ['appendToDay', () => appendToDay('2026-02-30', 'text')],
    [
      'replaceDays',
      () => replaceDays([{ dayId: '2026-02-30', humanTitle: '', contentMd: '' }]),
    ],
  ])('rejects %s before database or dirty-state work', async (_name, operation) => {
    await expect(operation()).rejects.toThrow('Invalid day ID: 2026-02-30')
    expect(mocks.queryOne).not.toHaveBeenCalled()
    expect(mocks.run).not.toHaveBeenCalled()
    expect(mocks.runDatabaseTransaction).not.toHaveBeenCalled()
    expect(mocks.upsertFts).not.toHaveBeenCalled()
    expect(mocks.markSyncLocalDirty).not.toHaveBeenCalled()
  })
})
