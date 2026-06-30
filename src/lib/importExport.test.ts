import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listDays: vi.fn(),
  replaceDays: vi.fn(),
  saveDay: vi.fn(),
  runBulkDatabaseMutation: vi.fn(async (callback: () => Promise<unknown>) => callback()),
  set: vi.fn(),
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
  })

  it('blocks zero-marker replacement without changing local days', async () => {
    const { importMarkdownToDb } = await import('./importExport')

    await expect(importMarkdownToDb('plain text only', { replace: true })).resolves.toEqual({
      imported: 0,
      warnings: ['No day markers found.'],
    })

    expect(mocks.listDays).not.toHaveBeenCalled()
    expect(mocks.replaceDays).not.toHaveBeenCalled()
    expect(mocks.saveDay).not.toHaveBeenCalled()
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it('blocks duplicate day markers before writing', async () => {
    const { importMarkdownToDb } = await import('./importExport')
    const source = `${markdownDay('2026-06-29', 'first')}

${markdownDay('2026-06-29', 'second')}`

    await expect(importMarkdownToDb(source)).rejects.toMatchObject({
      name: 'ImportSafetyError',
      reason: 'duplicate-day-markers',
    })

    expect(mocks.replaceDays).not.toHaveBeenCalled()
    expect(mocks.saveDay).not.toHaveBeenCalled()
    expect(mocks.set).not.toHaveBeenCalled()
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
        reason: 'would-delete-local-days',
        deletedDayIds: ['2026-06-29'],
      })

    expect(mocks.replaceDays).not.toHaveBeenCalled()
    expect(mocks.set).not.toHaveBeenCalled()
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
    const { IMPORT_ROLLBACK_BACKUP_KEY, importMarkdownToDb } = await import('./importExport')

    await expect(
      importMarkdownToDb(markdownDay('2026-06-30', 'remote'), {
        replace: true,
        allowDestructiveReplace: true,
      }),
    ).resolves.toEqual({ imported: 1, warnings: [] })

    expect(mocks.set).toHaveBeenCalledWith(
      IMPORT_ROLLBACK_BACKUP_KEY,
      expect.objectContaining({
        dayCount: 2,
        contentMd: expect.stringContaining('local only'),
      }),
    )
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
})
