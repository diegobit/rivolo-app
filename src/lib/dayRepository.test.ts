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

describe('appendToDay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const mockStoredDay = (initialContent: string) => {
    const row = {
      day_id: '2026-07-11',
      human_title: 'Saturday, July 11, 2026',
      content_md: initialContent,
      created_at: 1,
      updated_at: 1,
    }

    mocks.queryOne.mockImplementation(async () => ({ ...row }))
    mocks.run.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.startsWith('UPDATE days SET human_title')) {
        row.content_md = params[1] as string
      }
    })

    return row
  }

  it('preserves existing content byte-for-byte when appending', async () => {
    const original = '\n\n  indented first line\nbody'
    mockStoredDay(original)

    const day = await appendToDay('2026-07-11', '  appended text  ')

    expect(day?.contentMd).toBe(`${original}\n\nappended text`)
  })

  it('stores exactly the trimmed appended text when existing content is empty', async () => {
    mockStoredDay('')

    const day = await appendToDay('2026-07-11', '  appended text\n')

    expect(day?.contentMd).toBe('appended text')
  })
})
