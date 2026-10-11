// @vitest-environment node
import vm from 'node:vm'
import { get, set } from 'idb-keyval'
import { deflateSync, strToU8 } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addDays } from './dates'
import { parseMarkdown } from './markdown'
import { closeStorage, createStorage, reopenStorage, type Storage } from '../test/helpers/storage'

let storage: Storage
beforeEach(async () => { storage = await createStorage() })
afterEach(() => { closeStorage(storage) })
const markdownDay = (id: string, content: string) => `<!-- day:${id} -->\n${id}\n---\n\n${content}`
const seed = async () => {
  await storage.repository.saveDay('2026-06-30', 'local current', 'Current', { markDirty: false })
  await storage.repository.saveDay('2026-06-29', 'local only', 'Older', { markDirty: false })
  await storage.db.flushDatabaseSave()
}
const notes = async () => (await storage.repository.listAllDays()).map(({ dayId, contentMd }) => [dayId, contentMd])

describe('import/export durable storage boundary', () => {
  it.each([
    ['marker-free', 'plain text', 'no-day-markers'],
    ['invalid-date-only', markdownDay('2026-02-30', 'invalid'), 'no-valid-days'],
  ])('never replaces notes with %s content, across confirmation states', async (_label, source, reason) => {
    await seed()
    for (const allowUnsafeImport of [undefined, false, true]) {
      await expect(storage.importer.importMarkdownToDb(source, { replace: true, allowUnsafeImport })).rejects.toMatchObject({
        name: 'ImportSafetyError', reasons: [reason], deletedDayIds: [],
        warnings: reason === 'no-day-markers' ? ['No day markers found.'] : ['Invalid day marker for 2026-02-30; skipping block.'],
      })
      expect(await notes()).toEqual([['2026-06-30', 'local current'], ['2026-06-29', 'local only']])
      expect(await storage.importer.listRollbackBackups()).toEqual([])
    }
    storage = await reopenStorage(storage)
    expect(await notes()).toEqual([['2026-06-30', 'local current'], ['2026-06-29', 'local only']])
  })

  it('imports no marker-free content in merge mode', async () => {
    await expect(storage.importer.importMarkdownToDb('plain text')).resolves.toEqual({ imported: 0, warnings: ['No day markers found.'] })
    expect(await notes()).toEqual([])
  })

  it('reports duplicate markers and omitted local days together without writing or backing up', async () => {
    await seed()
    const duplicate = `${markdownDay('2026-06-30', 'first')}\n\n${markdownDay('2026-06-30', 'second')}`
    await expect(storage.importer.importMarkdownToDb(duplicate, { replace: true })).rejects.toMatchObject({
      reasons: ['duplicate-day-markers', 'would-delete-local-days'], deletedDayIds: ['2026-06-29'],
    })
    await expect(storage.importer.importMarkdownToDb(duplicate)).rejects.toMatchObject({ reasons: ['duplicate-day-markers'] })
    expect(await notes()).toEqual([['2026-06-30', 'local current'], ['2026-06-29', 'local only']])
    expect(await storage.importer.listRollbackBackups()).toEqual([])
  })

  it('confirmed replacement keeps the last duplicate and a recoverable backup of every original day', async () => {
    await seed()
    await storage.importer.importMarkdownToDb(`${markdownDay('2026-06-30', 'first')}\n\n${markdownDay('2026-06-30', 'second')}`, { replace: true, allowUnsafeImport: true })
    storage = await reopenStorage(storage)
    expect(await notes()).toEqual([['2026-06-30', 'second']])
    const backups = await storage.importer.listRollbackBackups()
    expect(backups).toHaveLength(1)
    expect(backups[0].dayCount).toBe(2)
    expect(parseMarkdown(backups[0].contentMd).days.map(({ dayId, contentMd }) => [dayId, contentMd])).toEqual([
      ['2026-06-30', 'local current'], ['2026-06-29', 'local only'],
    ])
    await storage.importer.importMarkdownToDb(backups[0].contentMd, { replace: true, allowUnsafeImport: true })
    storage = await reopenStorage(storage)
    expect(await notes()).toEqual([['2026-06-30', 'local current'], ['2026-06-29', 'local only']])
    expect((await storage.importer.listRollbackBackups())[0].contentMd).toContain('second')
  })

  it('does not replace local notes if the IndexedDB backup write fails', async () => {
    await seed()
    const open = indexedDB.open('keyval-store')
    const connection = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })
    const original = connection.transaction.bind(connection)
    // idb-keyval uses its cached connection, so inject a real put failure on
    // the public IDBObjectStore API rather than inventing a successful backup.
    const prototype = Object.getPrototypeOf(original('keyval', 'readwrite').objectStore('keyval')) as IDBObjectStore
    const put = prototype.put
    prototype.put = function(value, key) {
      if (key === 'rivolo.import.rollbackBackups') throw new DOMException('quota exceeded', 'QuotaExceededError')
      return put.call(this, value, key)
    }
    try {
      await expect(storage.importer.importMarkdownToDb(markdownDay('2026-06-30', 'remote'), { replace: true, allowUnsafeImport: true })).rejects.toThrow('quota exceeded')
      expect(await notes()).toEqual([['2026-06-30', 'local current'], ['2026-06-29', 'local only']])
      expect(await storage.importer.listRollbackBackups()).toEqual([])
    } finally { prototype.put = put; connection.close() }
  })

  it('saves the current rollback before the replacement transaction begins', async () => {
    await seed()
    storage.database.exec("CREATE TRIGGER reject_remote BEFORE INSERT ON days WHEN NEW.content_md = 'remote' BEGIN SELECT RAISE(ABORT, 'replacement rejected'); END")
    await expect(storage.importer.importMarkdownToDb(markdownDay('2026-06-30', 'remote'), { replace: true, allowUnsafeImport: true })).rejects.toThrow('replacement rejected')
    expect(await notes()).toEqual([['2026-06-30', 'local current'], ['2026-06-29', 'local only']])
    expect((await storage.importer.listRollbackBackups())[0]?.contentMd).toContain('local only')
  })

  it('round-trips literal day-marker examples through stored export/import and reopen', async () => {
    const literal = '```md\n<!-- day:2026-01-01 -->\n```\nprefix <!-- day:2024-12-31 --> suffix'
    await storage.repository.saveDay('2026-07-11', literal)
    const exported = await storage.importer.exportMarkdownFromDb()
    await storage.importer.importMarkdownToDb(exported, { replace: true })
    storage = await reopenStorage(storage)
    expect(await notes()).toEqual([['2026-07-11', literal]])
  })

  it('retains ten newest backups and migrates the legacy uncompressed backup', async () => {
    await set('rivolo.import.latestRollbackBackup', { createdAt: 50, contentMd: '# legacy backup', dayCount: 4 })
    await storage.importer.saveRollbackBackup(markdownDay('2026-07-01', 'first'))
    expect(await get('rivolo.import.latestRollbackBackup')).toBeUndefined()
    expect((await storage.importer.listRollbackBackups())[1]).toMatchObject({ createdAt: 50, contentMd: '# legacy backup', dayCount: 4 })
    let timestamp = Date.now() + 1000
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => timestamp++)
    try {
      for (let i = 0; i < 11; i++) {
        await storage.importer.saveRollbackBackup(markdownDay('2026-07-01', `backup ${i}`))
      }
    } finally { clock.mockRestore() }
    const backups = await storage.importer.listRollbackBackups()
    expect(backups).toHaveLength(10)
    expect(backups.map((backup) => parseMarkdown(backup.contentMd).days[0].contentMd)).toEqual(
      Array.from({ length: 10 }, (_, i) => `backup ${10 - i}`),
    )
  })

  it('reads compressed bytes cloned from another realm and ignores corrupt backups', async () => {
    const OtherBytes = vm.runInNewContext('Uint8Array') as Uint8ArrayConstructor
    await set('rivolo.import.rollbackBackups', [
      { createdAt: 300, contentMdGz: OtherBytes.from(deflateSync(strToU8('# intact backup'))), dayCount: 2 },
      { createdAt: 200, contentMdGz: new Uint8Array([1, 2, 3]), dayCount: 1 },
    ])
    expect(await storage.importer.listRollbackBackups()).toEqual([{ createdAt: 300, contentMd: '# intact backup', dayCount: 2 }])
    await storage.importer.saveRollbackBackup(markdownDay('2026-07-01', 'next'))
    expect((await storage.importer.listRollbackBackups()).map((backup) => backup.dayCount)).toEqual([1, 2])
  })

  it('exports over 10000 real rows and includes the oldest day in safety checks and rollback', async () => {
    const statement = storage.database.prepare('INSERT INTO days VALUES (?, ?, ?, ?, ?)')
    storage.database.transaction(() => {
      for (let i = 0; i < 10001; i++) {
        const dayId = addDays('1999-12-31', i)
        statement.bind([dayId, dayId, i === 0 ? 'oldest important archive' : `record ${i}`, 1, 1]).stepReset()
      }
    })
    statement.finalize()
    const exported = await storage.importer.exportMarkdownFromDb()
    expect(parseMarkdown(exported).days).toHaveLength(10001)
    expect(exported).toContain('oldest important archive')
    const recentOnly = markdownDay(addDays('1999-12-31', 10000), 'newest')
    await expect(storage.importer.importMarkdownToDb(recentOnly, { replace: true })).rejects.toMatchObject({
      reasons: ['would-delete-local-days'], deletedDayIds: expect.arrayContaining(['1999-12-31']),
    })
    await storage.importer.importMarkdownToDb(recentOnly, { replace: true, allowUnsafeImport: true })
    storage = await reopenStorage(storage)
    const backup = (await storage.importer.listRollbackBackups())[0]
    expect(backup.dayCount).toBe(10001)
    expect(parseMarkdown(backup.contentMd).days.find((day) => day.dayId === '1999-12-31')?.contentMd).toBe('oldest important archive')
    expect(await notes()).toEqual([[addDays('1999-12-31', 10000), 'newest']])
  })
})
