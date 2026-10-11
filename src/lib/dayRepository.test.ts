// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addDays } from './dates'
import { closeStorage, createStorage, reopenStorage, type Storage } from '../test/helpers/storage'

let storage: Storage
beforeEach(async () => { storage = await createStorage() })
afterEach(() => { closeStorage(storage) })

const write = (dayId: string, contentMd: string, humanTitle = dayId) =>
  storage.repository.saveDay(dayId, contentMd, humanTitle, { markDirty: false })

const ids = async (query: string, filter?: 'open-todos' | 'tags' | 'mentions' | 'headings', limit = 30) =>
  (await storage.repository.searchDays(query, { filter }, limit)).map(({ day }) => day.dayId)

describe('persisted day repository', () => {
  it.each(['ensureDay', 'saveDay', 'appendLineToDay', 'appendToDay', 'replaceDays', 'move source', 'move target'])(
    'rejects invalid dates through %s without stored changes', async (operation) => {
      await write('2026-03-01', 'keep me')
      const repo = storage.repository
      const calls: Record<string, () => Promise<unknown>> = {
        ensureDay: () => repo.ensureDay('2026-02-30'),
        saveDay: () => repo.saveDay('2026-02-30', 'bad'),
        appendLineToDay: () => repo.appendLineToDay('2026-02-30', 'bad'),
        appendToDay: () => repo.appendToDay('2026-02-30', 'bad'),
        replaceDays: () => repo.replaceDays([{ dayId: '2026-02-30', humanTitle: '', contentMd: '' }]),
        'move source': () => repo.moveDay('2026-02-30', '2026-03-01'),
        'move target': () => repo.moveDay('2026-03-01', '2026-02-30'),
      }
      await expect(calls[operation]()).rejects.toThrow('Invalid day ID')
      expect((await repo.listAllDays()).map((day) => [day.dayId, day.contentMd])).toEqual([['2026-03-01', 'keep me']])
      expect(await storage.settings.getJsonSetting('dropbox.state')).toBeNull()
    },
  )

  it('maintains searchable rows through save, edit, move, delete and replacement, including reopen', async () => {
    await write('2026-07-12', 'alpha original')
    expect(await ids('alpha')).toEqual(['2026-07-12'])
    await write('2026-07-12', 'beta edited')
    expect(await ids('alpha')).toEqual([])
    expect(await ids('beta')).toEqual(['2026-07-12'])
    await storage.repository.moveDay('2026-07-12', '2026-07-13')
    expect(await ids('beta')).toEqual(['2026-07-13'])
    await storage.repository.deleteDay('2026-07-13')
    expect(await ids('beta')).toEqual([])
    await storage.repository.replaceDays([{ dayId: '2026-07-14', humanTitle: 'Replacement', contentMd: 'gamma replacement' }])
    storage = await reopenStorage(storage)
    expect(await ids('gamma')).toEqual(['2026-07-14'])
    expect(await ids('beta')).toEqual([])
    expect((await storage.repository.listAllDays()).map((day) => day.dayId)).toEqual(['2026-07-14'])
  })

  it('rolls back note and index changes when a replacement insert fails', async () => {
    await write('2026-07-12', 'original preserved')
    // Database-level rejection, not a mocked repository receipt.
    storage.database.exec("CREATE TRIGGER reject_test_day BEFORE INSERT ON days WHEN NEW.day_id = '2026-07-14' BEGIN SELECT RAISE(ABORT, 'test insert rejected'); END")
    await expect(storage.repository.replaceDays([
      { dayId: '2026-07-13', humanTitle: 'First', contentMd: 'first replacement' },
      { dayId: '2026-07-14', humanTitle: 'Rejected', contentMd: 'second replacement' },
    ])).rejects.toThrow('test insert rejected')
    storage = await reopenStorage(storage)
    expect(await ids('original')).toEqual(['2026-07-12'])
    expect(await ids('replacement')).toEqual([])
  })

  it.each([
    ['100%_', ['2026-07-12']], ['"quoted"', ['2026-07-12']], ["O'Reilly", ['2026-07-12']],
    ['CAFÉ', ['2026-07-11']], ['აბგ', ['2026-07-10']], ['ꭰꭱꭲ', ['2026-07-09']],
    ['é🙂', ['2026-07-11']], ['a', ['2026-07-12', '2026-07-11', '2026-07-08']],
  ])('returns independently specified matches for literal/Unicode query %s', async (query, expected) => {
    await write('2026-07-12', '100%_ "quoted" O\'Reilly', 'alpha')
    await write('2026-07-11', 'café é🙂', 'Other')
    await write('2026-07-10', 'აბგ', 'Other')
    await write('2026-07-09', 'ꭰꭱꭲ', 'Other')
    await write('2026-07-08', '100XX wildcard near miss', 'Other')
    expect(await ids(query)).toEqual(expected)
  })

  it.each([
    ['open-todos', ['- [ ] open #ship @alice']],
    ['tags', ['- [ ] open #ship @alice', 'Discuss #ship']],
    ['mentions', ['- [ ] open #ship @alice']],
    ['headings', ['# Morning\n- [ ] open #ship @alice\n- [x] complete\n- [-] cancelled\nDiscuss #ship\n## Afternoon\nordinary text', '## Afternoon\nordinary text']],
  ] as const)('returns exact %s blocks from persisted notes', async (filter, expected) => {
    await write('2026-07-12', '# Morning\n- [ ] open #ship @alice\n- [x] complete\n- [-] cancelled\nDiscuss #ship\n## Afternoon\nordinary text')
    const results = await storage.repository.searchDays('', { filter })
    expect(results.map(({ day, matchedBlocks, blockKind }) => ({ dayId: day.dayId, matchedBlocks, blockKind }))).toEqual([
      { dayId: '2026-07-12', matchedBlocks: [...expected], blockKind: filter === 'headings' ? 'section' : 'line' },
    ])
  })

  it('pages past a full batch of false-positive filter candidates', async () => {
    for (let i = 0; i < 55; i++) await write(addDays('2026-07-01', i), '- [x] needle completed')
    await write('2026-06-30', '- [ ] needle actual match')
    expect(await ids('needle', 'open-todos', 1)).toEqual(['2026-06-30'])
  })

  it('preserves concurrent appends and newline rules through durable reopen', async () => {
    await write('2026-07-12', '\n\n  indented first line\nbody')
    await Promise.all([
      storage.repository.appendToDay('2026-07-12', '  paragraph  '),
      storage.repository.appendLineToDay('2026-07-12', ' line '),
      storage.repository.appendToDay('2026-07-13', 'first'),
      storage.repository.appendToDay('2026-07-13', 'second'),
    ])
    storage = await reopenStorage(storage)
    expect((await storage.repository.getDay('2026-07-12'))?.contentMd).toBe('\n\n  indented first line\nbody\n\nparagraph\nline')
    expect((await storage.repository.getDay('2026-07-13'))?.contentMd).toBe('first\n\nsecond')
    expect(await ids('second')).toEqual(['2026-07-13'])
  })

  it('allows appends to recover after a rejected write without losing the next addition', async () => {
    await write('2026-07-12', 'base')
    storage.database.exec("CREATE TRIGGER reject_append BEFORE UPDATE ON days WHEN NEW.content_md LIKE '%failing%' BEGIN SELECT RAISE(ABORT, 'append rejected'); END")
    const first = storage.repository.appendToDay('2026-07-12', 'failing')
    const second = storage.repository.appendToDay('2026-07-12', 'succeeding')
    await expect(first).rejects.toThrow('append rejected')
    await second
    await storage.repository.appendToDay('2026-07-12', 'third')
    expect((await storage.repository.getDay('2026-07-12'))?.contentMd).toBe('base\n\nsucceeding\n\nthird')
  })

  it('does not block another day behind a paused append', async () => {
    await write('2026-07-12', 'base')
    await write('2026-07-13', 'other')
    let release!: () => void
    let started!: () => void
    const pause = new Promise<void>((resolve) => { release = resolve })
    const ready = new Promise<void>((resolve) => { started = resolve })
    const original = storage.db.run
    vi.spyOn(storage.db, 'run').mockImplementation(async (sql, params = []) => {
      if (sql.startsWith('UPDATE days') && params[3] === '2026-07-12') { started(); await pause }
      return original(sql, params)
    })
    const first = storage.repository.appendToDay('2026-07-12', 'paused')
    await ready
    await storage.repository.appendToDay('2026-07-13', 'independent')
    expect((await storage.repository.getDay('2026-07-13'))?.contentMd).toBe('other\n\nindependent')
    release()
    await first
  })
})
