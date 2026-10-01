import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  appendLineToDay,
  appendToDay,
  ensureDay,
  listAllDays,
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

describe('listAllDays', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('queries all rows in descending order without a LIMIT clause', async () => {
    const rows = [
      {
        day_id: '2026-07-12',
        human_title: 'Sunday, July 12, 2026',
        content_md: 'content 1',
        created_at: 10,
        updated_at: 20,
      },
      {
        day_id: '2026-07-11',
        human_title: 'Saturday, July 11, 2026',
        content_md: 'content 2',
        created_at: 30,
        updated_at: 40,
      },
    ]
    mocks.queryAll.mockResolvedValueOnce(rows)

    const result = await listAllDays()

    expect(mocks.queryAll).toHaveBeenCalledWith(
      'SELECT day_id, human_title, content_md, created_at, updated_at FROM days ORDER BY day_id DESC',
    )
    expect(result).toEqual([
      {
        dayId: '2026-07-12',
        humanTitle: 'Sunday, July 12, 2026',
        contentMd: 'content 1',
        createdAt: 10,
        updatedAt: 20,
      },
      {
        dayId: '2026-07-11',
        humanTitle: 'Saturday, July 11, 2026',
        contentMd: 'content 2',
        createdAt: 30,
        updatedAt: 40,
      },
    ])
  })
})

describe('appendToDay and appendLineToDay concurrency', () => {
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

  const createMockDb = (initialDays: Record<string, { contentMd: string; humanTitle?: string }> = {}) => {
    const store = new Map<
      string,
      { day_id: string; human_title: string; content_md: string; created_at: number; updated_at: number }
    >()

    for (const [dayId, data] of Object.entries(initialDays)) {
      store.set(dayId, {
        day_id: dayId,
        human_title: data.humanTitle ?? `${dayId} Title`,
        content_md: data.contentMd,
        created_at: 1,
        updated_at: 1,
      })
    }

    mocks.queryOne.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.includes('FROM days WHERE day_id = ?')) {
        const dayId = params[0] as string
        const item = store.get(dayId)
        return item ? { ...item } : null
      }
      return null
    })

    mocks.run.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.startsWith('INSERT OR IGNORE INTO days')) {
        const [dayId, humanTitle, contentMd, createdAt, updatedAt] = params as [
          string,
          string,
          string,
          number,
          number,
        ]
        if (!store.has(dayId)) {
          store.set(dayId, {
            day_id: dayId,
            human_title: humanTitle,
            content_md: contentMd,
            created_at: createdAt,
            updated_at: updatedAt,
          })
        }
      } else if (sql.startsWith('INSERT INTO days')) {
        const [dayId, humanTitle, contentMd, createdAt, updatedAt] = params as [
          string,
          string,
          string,
          number,
          number,
        ]
        store.set(dayId, {
          day_id: dayId,
          human_title: humanTitle,
          content_md: contentMd,
          created_at: createdAt,
          updated_at: updatedAt,
        })
      } else if (sql.startsWith('UPDATE days SET human_title')) {
        const [humanTitle, contentMd, updatedAt, dayId] = params as [string, string, number, string]
        const existing = store.get(dayId)
        if (existing) {
          store.set(dayId, {
            ...existing,
            human_title: humanTitle,
            content_md: contentMd,
            updated_at: updatedAt,
          })
        }
      }
    })

    return store
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

  it('preserves both concurrent appendToDay additions', async () => {
    const store = createMockDb({
      '2026-09-02': { contentMd: 'base', humanTitle: 'Wednesday, September 2, 2026' },
    })

    let releaseFirst: () => void
    const pauseFirst = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let firstStarted: () => void
    const waitForFirstStart = new Promise<void>((resolve) => {
      firstStarted = resolve
    })

    let callCount = 0
    const originalRun = mocks.run.getMockImplementation()!
    mocks.run.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.startsWith('UPDATE days SET human_title') && params[3] === '2026-09-02') {
        callCount++
        if (callCount === 1) {
          firstStarted()
          await pauseFirst
        }
      }
      return originalRun(sql, params)
    })

    const firstPromise = appendToDay('2026-09-02', 'first')
    await waitForFirstStart

    // The second call overlaps while the first is blocked
    const secondPromise = appendToDay('2026-09-02', 'second')

    // Release the first call without waiting for a second read
    releaseFirst!()

    const [firstResult, secondResult] = await Promise.all([firstPromise, secondPromise])

    expect(firstResult?.contentMd).toBe('base\n\nfirst')
    expect(secondResult?.contentMd).toBe('base\n\nfirst\n\nsecond')
    expect(store.get('2026-09-02')?.content_md).toBe('base\n\nfirst\n\nsecond')

    expect(mocks.upsertFts).toHaveBeenLastCalledWith(
      '2026-09-02',
      'Wednesday, September 2, 2026',
      'base\n\nfirst\n\nsecond',
    )
    expect(mocks.markSyncLocalDirty).toHaveBeenCalled()
  })

  it('handles simultaneous creation on an absent day', async () => {
    const store = createMockDb()

    const [first, second] = await Promise.all([
      appendToDay('2026-09-03', 'first addition'),
      appendToDay('2026-09-03', 'second addition'),
    ])

    expect(store.get('2026-09-03')?.content_md).toBe('first addition\n\nsecond addition')
    expect(first?.contentMd).toBe('first addition')
    expect(second?.contentMd).toBe('first addition\n\nsecond addition')
  })

  it('handles mixed appendToDay and appendLineToDay calls with exact newline rules', async () => {
    const store = createMockDb({
      '2026-09-04': { contentMd: 'initial line  \n' },
    })

    const [r1, r2] = await Promise.all([
      appendLineToDay('2026-09-04', 'second line'),
      appendToDay('2026-09-04', 'third paragraph'),
    ])

    expect(store.get('2026-09-04')?.content_md).toBe(
      'initial line\nsecond line\n\nthird paragraph',
    )
    expect(r1?.contentMd).toBe('initial line\nsecond line')
    expect(r2?.contentMd).toBe('initial line\nsecond line\n\nthird paragraph')
  })

  it('allows later append calls after a rejected append to proceed', async () => {
    const store = createMockDb({
      '2026-09-05': { contentMd: 'base' },
    })

    let shouldFail = true
    const originalRun = mocks.run.getMockImplementation()!
    mocks.run.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.startsWith('UPDATE days SET human_title') && params[3] === '2026-09-05' && shouldFail) {
        shouldFail = false
        throw new Error('Database write failure')
      }
      return originalRun(sql, params)
    })

    const firstPromise = appendToDay('2026-09-05', 'failing')
    const secondPromise = appendToDay('2026-09-05', 'succeeding')

    await expect(firstPromise).rejects.toThrow('Database write failure')
    const secondResult = await secondPromise

    expect(secondResult?.contentMd).toBe('base\n\nsucceeding')
    expect(store.get('2026-09-05')?.content_md).toBe('base\n\nsucceeding')

    const thirdResult = await appendToDay('2026-09-05', 'third')
    expect(thirdResult?.contentMd).toBe('base\n\nsucceeding\n\nthird')
  })

  it('does not block an append for another day when one day is paused', async () => {
    const store = createMockDb({
      '2026-09-01': { contentMd: 'day1 base' },
      '2026-09-02': { contentMd: 'day2 base' },
    })

    let releaseDay1: () => void
    const pauseDay1 = new Promise<void>((resolve) => {
      releaseDay1 = resolve
    })
    let day1Started: () => void
    const waitForDay1Start = new Promise<void>((resolve) => {
      day1Started = resolve
    })

    const originalRun = mocks.run.getMockImplementation()!
    mocks.run.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.startsWith('UPDATE days SET human_title') && params[3] === '2026-09-01') {
        day1Started()
        await pauseDay1
      }
      return originalRun(sql, params)
    })

    const day1Promise = appendToDay('2026-09-01', 'day1 append')
    await waitForDay1Start

    // Day 2 should proceed immediately without waiting for Day 1
    const day2Result = await appendToDay('2026-09-02', 'day2 append')
    expect(day2Result?.contentMd).toBe('day2 base\n\nday2 append')
    expect(store.get('2026-09-02')?.content_md).toBe('day2 base\n\nday2 append')

    // Now release Day 1
    releaseDay1!()
    const day1Result = await day1Promise
    expect(day1Result?.contentMd).toBe('day1 base\n\nday1 append')
    expect(store.get('2026-09-01')?.content_md).toBe('day1 base\n\nday1 append')
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
