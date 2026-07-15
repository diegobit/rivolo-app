import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  appendLineToDay,
  appendToDay,
  ensureDay,
  moveDay,
  replaceDays,
  saveDay,
  searchDays,
} from './dayRepository'
import { searchDaysInMemory, type Day } from './notesCore'

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

describe('FTS write maintenance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.queryOne.mockResolvedValue(null)
    mocks.runDatabaseTransaction.mockImplementation(async (callback) => callback())
    mocks.isFtsAvailable.mockResolvedValue(true)
  })

  it('updates the index when a day is saved', async () => {
    await saveDay('2026-07-12', 'indexed content', 'Indexed title')

    expect(mocks.upsertFts).toHaveBeenCalledWith(
      '2026-07-12',
      'Indexed title',
      'indexed content',
    )
  })

  it('rebuilds index rows when all days are replaced', async () => {
    await replaceDays(
      [
        { dayId: '2026-07-12', humanTitle: 'First', contentMd: 'alpha' },
        { dayId: '2026-07-11', humanTitle: 'Second', contentMd: 'beta' },
      ],
      { markDirty: false },
    )

    expect(mocks.run).toHaveBeenCalledWith('DELETE FROM days_fts')
    expect(mocks.upsertFts.mock.calls).toEqual([
      ['2026-07-12', 'First', 'alpha'],
      ['2026-07-11', 'Second', 'beta'],
    ])
  })
})

describe('searchDays', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isFtsAvailable.mockResolvedValue(false)
  })

  const toRow = (day: Day) => ({
    day_id: day.dayId,
    human_title: day.humanTitle,
    content_md: day.contentMd,
    created_at: day.createdAt,
    updated_at: day.updatedAt,
  })

  it('builds an escaped, term-wise LIKE prefilter with a bounded query', async () => {
    mocks.queryAll.mockResolvedValue([])

    await searchDays(' 100%_ "quoted" O\'Reilly ')

    const [sql, params] = mocks.queryAll.mock.calls[0]
    expect(sql).toContain(
      "WHERE (human_title LIKE ? ESCAPE '\\' OR content_md LIKE ? ESCAPE '\\') AND (human_title LIKE ? ESCAPE '\\' OR content_md LIKE ? ESCAPE '\\') AND (human_title LIKE ? ESCAPE '\\' OR content_md LIKE ? ESCAPE '\\')",
    )
    expect(sql).toContain('LIMIT ? OFFSET ?')
    expect(params).toEqual([
      '%100\\%\\_%',
      '%100\\%\\_%',
      '%"quoted"%',
      '%"quoted"%',
      "%O'Reilly%",
      "%O'Reilly%",
      120,
      0,
    ])
  })

  it('uses the trigram FTS index for literal queries of at least three code points', async () => {
    mocks.isFtsAvailable.mockResolvedValue(true)
    mocks.queryAll.mockResolvedValue([])

    await searchDays('100%_ "quoted"')

    const [sql, params] = mocks.queryAll.mock.calls[0]
    expect(sql).toContain('FROM days_fts')
    expect(sql).toContain('WHERE days_fts MATCH ?')
    expect(params).toEqual(['"100%_ ""quoted"""', 120, 0])
  })

  it('keeps one and two code-point queries on the LIKE fallback', async () => {
    mocks.isFtsAvailable.mockResolvedValue(true)
    mocks.queryAll.mockResolvedValue([])

    await searchDays('é🙂')

    const [sql] = mocks.queryAll.mock.calls[0]
    expect(sql).toContain('FROM days')
    expect(sql).not.toContain('FROM days_fts')
    expect(mocks.isFtsAvailable).not.toHaveBeenCalled()
  })

  it.each(['CAFÉ', 'აბგ', 'ꭰꭱꭲ'])(
    'leaves non-ASCII query %s to the locale-aware in-memory matcher',
    async (query) => {
      mocks.isFtsAvailable.mockResolvedValue(true)
      mocks.queryAll.mockResolvedValue([])

      await searchDays(query)

      const [sql, params] = mocks.queryAll.mock.calls[0]
      expect(sql).toContain('FROM days')
      expect(sql).not.toContain('FROM days_fts')
      expect(sql).not.toContain('WHERE')
      expect(params).toEqual([120, 0])
      expect(mocks.isFtsAvailable).not.toHaveBeenCalled()
    },
  )

  it('keeps paging past false-positive candidates to preserve old search results', async () => {
    const falsePositives = Array.from({ length: 50 }, (_, index) =>
      toRow({
        dayId: `2026-06-${String(50 - index).padStart(2, '0')}`,
        humanTitle: 'alpha title',
        contentMd: 'beta appears on a different line',
        createdAt: index,
        updatedAt: index,
      }),
    )
    const match = toRow({
      dayId: '2026-05-01',
      humanTitle: 'Match',
      contentMd: 'the alpha beta phrase matches',
      createdAt: 51,
      updatedAt: 51,
    })
    mocks.queryAll
      .mockResolvedValueOnce(falsePositives)
      .mockResolvedValueOnce([match])

    const results = await searchDays('alpha beta', {}, 1)

    expect(results.map(({ day }) => day.dayId)).toEqual(['2026-05-01'])
    expect(mocks.queryAll).toHaveBeenCalledTimes(2)
    expect(mocks.queryAll.mock.calls[1][1]).toEqual(['%alpha%', '%alpha%', '%beta%', '%beta%', 50, 50])
  })

  it('matches the previous in-memory behavior on representative queries and filters', async () => {
    const days: Day[] = [
      {
        dayId: '2026-07-03',
        humanTitle: 'Release 100%_ "quoted"',
        contentMd: 'first line\n- [ ] Alpha beta task #ship @team',
        createdAt: 3,
        updatedAt: 3,
      },
      {
        dayId: '2026-07-02',
        humanTitle: 'Unicode CAFÉ',
        contentMd: 'A café note\n# Alpha heading',
        createdAt: 2,
        updatedAt: 2,
      },
      {
        dayId: '2026-07-01',
        humanTitle: 'Other',
        contentMd: 'alpha on one line\nbeta on another',
        createdAt: 1,
        updatedAt: 1,
      },
    ]
    const cases = [
      { query: '100%_ "quoted"', filter: null },
      { query: 'alpha beta', filter: null },
      { query: 'café', filter: null },
      { query: 'alpha', filter: 'open-todos' as const },
      { query: 'ship', filter: 'tags' as const },
      { query: '', filter: 'open-todos' as const },
    ]

    for (const { query, filter } of cases) {
      mocks.queryAll.mockImplementation(async (_sql: string, params: unknown[]) => {
        const batchSize = params.at(-2) as number
        const offset = params.at(-1) as number
        return days.slice(offset, offset + batchSize).map(toRow)
      })

      await expect(searchDays(query, { filter }, 30)).resolves.toEqual(
        searchDaysInMemory(days, query, { filter }, 30),
      )
      mocks.queryAll.mockReset()
    }
  })
})
