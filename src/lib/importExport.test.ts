import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate'

const mocks = vi.hoisted(() => ({
  listDays: vi.fn(),
  replaceDays: vi.fn(),
  saveDay: vi.fn(),
  runBulkDatabaseMutation: vi.fn(async (callback: () => Promise<unknown>) => callback()),
  set: vi.fn(),
  get: vi.fn(),
  del: vi.fn(),
}))

vi.mock('./dayRepository', () => ({
  listDays: mocks.listDays,
  replaceDays: mocks.replaceDays,
  saveDay: mocks.saveDay,
}))

vi.mock('./db', () => ({
  runBulkDatabaseMutation: mocks.runBulkDatabaseMutation,
}))

vi.mock('idb-keyval', () => ({
  set: mocks.set,
  get: mocks.get,
  del: mocks.del,
}))

const localDay = (dayId: string, contentMd: string) => ({
  dayId,
  humanTitle: dayId,
  contentMd,
  createdAt: 1,
  updatedAt: 1,
})

const markdownDay = (dayId: string, content: string) => `<!-- day:${dayId} -->
${dayId}
---

${content}`

describe('importMarkdownToDb safety checks', () => {
  beforeEach(() => {
    mocks.listDays.mockReset()
    mocks.replaceDays.mockReset()
    mocks.saveDay.mockReset()
    mocks.runBulkDatabaseMutation.mockClear()
    mocks.set.mockReset()
    mocks.get.mockReset()
    mocks.del.mockReset()
  })

  it('blocks zero-marker replacement without changing local days', async () => {
    const { importMarkdownToDb } = await import('./importExport')

    await expect(importMarkdownToDb('plain text only', { replace: true })).rejects.toMatchObject({
      name: 'ImportSafetyError',
      reasons: ['no-day-markers'],
    })

    expect(mocks.listDays).not.toHaveBeenCalled()
    expect(mocks.replaceDays).not.toHaveBeenCalled()
    expect(mocks.saveDay).not.toHaveBeenCalled()
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it('imports nothing from a zero-marker file without replace', async () => {
    const { importMarkdownToDb } = await import('./importExport')

    await expect(importMarkdownToDb('plain text only')).resolves.toEqual({
      imported: 0,
      warnings: ['No day markers found.'],
    })

    expect(mocks.saveDay).not.toHaveBeenCalled()
  })

  it('blocks duplicate day markers before writing', async () => {
    const { importMarkdownToDb } = await import('./importExport')
    const source = `${markdownDay('2026-06-29', 'first')}

${markdownDay('2026-06-29', 'second')}`

    await expect(importMarkdownToDb(source)).rejects.toMatchObject({
      name: 'ImportSafetyError',
      reasons: ['duplicate-day-markers'],
    })

    expect(mocks.replaceDays).not.toHaveBeenCalled()
    expect(mocks.saveDay).not.toHaveBeenCalled()
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it('imports duplicate day markers when explicitly allowed, keeping the last block', async () => {
    mocks.listDays.mockResolvedValue([localDay('2026-06-29', 'current')])
    const { importMarkdownToDb } = await import('./importExport')
    const source = `${markdownDay('2026-06-29', 'first')}

${markdownDay('2026-06-29', 'second')}`

    const result = await importMarkdownToDb(source, {
      replace: true,
      allowUnsafeImport: true,
    })

    expect(result.imported).toBe(1)
    expect(result.warnings).toEqual([
      expect.stringContaining('Duplicate day marker for 2026-06-29'),
    ])
    expect(mocks.replaceDays).toHaveBeenCalledWith(
      [expect.objectContaining({ dayId: '2026-06-29', contentMd: 'second' })],
      { markDirty: true },
    )
  })

  it('round-trips literal day markers through database export and import', async () => {
    const contentMd = `\`\`\`md
<!-- day:2026-01-01 -->
\`\`\`
prefix <!-- day:2024-12-31 --> suffix`
    mocks.listDays.mockResolvedValue([localDay('2026-07-11', contentMd)])
    const { exportMarkdownFromDb, importMarkdownToDb } = await import('./importExport')

    const exported = await exportMarkdownFromDb()
    const result = await importMarkdownToDb(exported)

    expect(result).toEqual({ imported: 1, warnings: [] })
    expect(mocks.saveDay).toHaveBeenCalledWith(
      '2026-07-11',
      contentMd,
      '2026-07-11',
      { markDirty: true },
    )
  })

  it('blocks replacement that would delete local days unless explicitly allowed', async () => {
    mocks.listDays.mockResolvedValue([
      localDay('2026-06-30', 'keep me'),
      localDay('2026-06-29', 'remote omits me'),
    ])
    const { importMarkdownToDb } = await import('./importExport')

    await expect(importMarkdownToDb(markdownDay('2026-06-30', 'remote'), { replace: true }))
      .rejects.toMatchObject({
        name: 'ImportSafetyError',
        reasons: ['would-delete-local-days'],
        deletedDayIds: ['2026-06-29'],
      })

    expect(mocks.replaceDays).not.toHaveBeenCalled()
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it('reports every safety problem in one error', async () => {
    mocks.listDays.mockResolvedValue([
      localDay('2026-06-30', 'keep me'),
      localDay('2026-06-28', 'remote omits me'),
    ])
    const { importMarkdownToDb } = await import('./importExport')
    const source = `${markdownDay('2026-06-30', 'first')}

${markdownDay('2026-06-30', 'second')}`

    await expect(importMarkdownToDb(source, { replace: true })).rejects.toMatchObject({
      name: 'ImportSafetyError',
      reasons: ['duplicate-day-markers', 'would-delete-local-days'],
      deletedDayIds: ['2026-06-28'],
    })

    expect(mocks.replaceDays).not.toHaveBeenCalled()
  })

  it('allows confirmed destructive replacement after writing the latest rollback backup', async () => {
    const events: string[] = []
    mocks.listDays.mockResolvedValue([
      localDay('2026-06-30', 'local current'),
      localDay('2026-06-29', 'local only'),
    ])
    mocks.set.mockImplementation(async () => {
      events.push('backup')
    })
    mocks.replaceDays.mockImplementation(async () => {
      events.push('replace')
    })
    const { IMPORT_ROLLBACK_BACKUPS_KEY, importMarkdownToDb } = await import('./importExport')

    await expect(
      importMarkdownToDb(markdownDay('2026-06-30', 'remote'), {
        replace: true,
        allowUnsafeImport: true,
      }),
    ).resolves.toEqual({ imported: 1, warnings: [] })

    expect(mocks.set).toHaveBeenCalledWith(
      IMPORT_ROLLBACK_BACKUPS_KEY,
      expect.arrayContaining([expect.objectContaining({ dayCount: 2 })]),
    )
    const [, saved] = mocks.set.mock.calls[0] as [string, { contentMdGz: Uint8Array }[]]
    expect(strFromU8(inflateSync(saved[0].contentMdGz))).toContain('local only')
    expect(mocks.replaceDays).toHaveBeenCalledWith(
      [
        {
          dayId: '2026-06-30',
          humanTitle: '2026-06-30',
          contentMd: 'remote',
        },
      ],
      { markDirty: true },
    )
    expect(events).toEqual(['backup', 'replace'])
  })

  it('prunes rollback backups to the ten most recent', async () => {
    mocks.listDays.mockResolvedValue([localDay('2026-06-30', 'current')])
    const backup = (createdAt: number) => ({
      createdAt,
      contentMd: `# backup ${createdAt}`,
      dayCount: 1,
    })
    const existing = Array.from({ length: 10 }, (_, index) => backup(1000 - index * 100))
    mocks.get.mockImplementation(async (key: string) =>
      key === 'rivolo.import.rollbackBackups' ? existing : undefined,
    )
    const { IMPORT_ROLLBACK_BACKUPS_KEY, importMarkdownToDb } = await import('./importExport')

    await importMarkdownToDb(markdownDay('2026-06-30', 'remote'), { replace: true })

    const [key, saved] = mocks.set.mock.calls[0] as [string, { createdAt: number }[]]
    expect(key).toBe(IMPORT_ROLLBACK_BACKUPS_KEY)
    expect(saved).toHaveLength(10)
    expect(saved.slice(1).map((entry) => entry.createdAt)).toEqual(
      existing.slice(0, 9).map((entry) => entry.createdAt),
    )
    expect(mocks.del).toHaveBeenCalledWith('rivolo.import.latestRollbackBackup')
  })

  it('migrates the legacy single backup into the retention list', async () => {
    mocks.listDays.mockResolvedValue([localDay('2026-06-30', 'current')])
    mocks.get.mockImplementation(async (key: string) =>
      key === 'rivolo.import.latestRollbackBackup'
        ? { createdAt: 50, contentMd: '# legacy backup', dayCount: 4 }
        : undefined,
    )
    const { IMPORT_ROLLBACK_BACKUPS_KEY, importMarkdownToDb } = await import('./importExport')

    await importMarkdownToDb(markdownDay('2026-06-30', 'remote'), { replace: true })

    const [key, saved] = mocks.set.mock.calls[0] as [
      string,
      { createdAt: number; dayCount: number; contentMdGz: Uint8Array }[],
    ]
    expect(key).toBe(IMPORT_ROLLBACK_BACKUPS_KEY)
    expect(saved).toEqual([
      expect.objectContaining({ dayCount: 1 }),
      expect.objectContaining({ createdAt: 50, dayCount: 4 }),
    ])
    expect(strFromU8(inflateSync(saved[1].contentMdGz))).toBe('# legacy backup')
    expect(mocks.del).toHaveBeenCalledWith('rivolo.import.latestRollbackBackup')
  })

  it('drops backups that no longer decompress instead of failing the import', async () => {
    mocks.listDays.mockResolvedValue([localDay('2026-06-30', 'current')])
    const existing = [
      { createdAt: 200, contentMdGz: deflateSync(strToU8('# intact backup')), dayCount: 1 },
      { createdAt: 100, contentMdGz: new Uint8Array([1, 2, 3]), dayCount: 1 },
    ]
    mocks.get.mockImplementation(async (key: string) =>
      key === 'rivolo.import.rollbackBackups' ? existing : undefined,
    )
    const { IMPORT_ROLLBACK_BACKUPS_KEY, importMarkdownToDb, listRollbackBackups } = await import(
      './importExport'
    )

    await expect(listRollbackBackups()).resolves.toEqual([
      expect.objectContaining({ createdAt: 200, contentMd: '# intact backup' }),
    ])

    await expect(
      importMarkdownToDb(markdownDay('2026-06-30', 'remote'), { replace: true }),
    ).resolves.toEqual({ imported: 1, warnings: [] })

    const [key, saved] = mocks.set.mock.calls[0] as [string, { createdAt: number }[]]
    expect(key).toBe(IMPORT_ROLLBACK_BACKUPS_KEY)
    expect(saved.map((entry) => entry.createdAt)).toEqual([expect.any(Number), 200])
  })
})
