import { beforeEach, describe, expect, it, vi } from 'vitest'

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

    expect(mocks.set).toHaveBeenCalledWith(IMPORT_ROLLBACK_BACKUPS_KEY, [
      expect.objectContaining({
        dayCount: 2,
        contentMd: expect.stringContaining('local only'),
      }),
    ])
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

  it('prunes rollback backups to the five most recent', async () => {
    mocks.listDays.mockResolvedValue([localDay('2026-06-30', 'current')])
    const backup = (createdAt: number) => ({
      createdAt,
      contentMd: `# backup ${createdAt}`,
      dayCount: 1,
    })
    const existing = [backup(500), backup(400), backup(300), backup(200), backup(100)]
    mocks.get.mockImplementation(async (key: string) =>
      key === 'rivolo.import.rollbackBackups' ? existing : undefined,
    )
    const { IMPORT_ROLLBACK_BACKUPS_KEY, importMarkdownToDb } = await import('./importExport')

    await importMarkdownToDb(markdownDay('2026-06-30', 'remote'), { replace: true })

    const [key, saved] = mocks.set.mock.calls[0] as [string, { createdAt: number }[]]
    expect(key).toBe(IMPORT_ROLLBACK_BACKUPS_KEY)
    expect(saved).toHaveLength(5)
    expect(saved.slice(1).map((entry) => entry.createdAt)).toEqual([500, 400, 300, 200])
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

    expect(mocks.set).toHaveBeenCalledWith(IMPORT_ROLLBACK_BACKUPS_KEY, [
      expect.objectContaining({ dayCount: 1 }),
      expect.objectContaining({
        createdAt: 50,
        contentMd: '# legacy backup',
        dayCount: 4,
      }),
    ])
    expect(mocks.del).toHaveBeenCalledWith('rivolo.import.latestRollbackBackup')
  })
})
