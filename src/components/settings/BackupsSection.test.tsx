import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BackupsSection from './BackupsSection'

const importExport = vi.hoisted(() => ({
  listRollbackBackups: vi.fn(),
  importMarkdownToDb: vi.fn(),
}))
const coordinator = vi.hoisted(() => ({
  getTabSyncBlockReason: vi.fn(),
}))

vi.mock('../../lib/importExport', () => importExport)
vi.mock('../../lib/tabSyncCoordinator', () => coordinator)

const backup = {
  createdAt: 1_780_000_000_000,
  contentMd: '# 2026-06-29\n\nbacked up note',
  dayCount: 2,
  reason: 'destructive-replace' as const,
}

describe('BackupsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    coordinator.getTabSyncBlockReason.mockReturnValue(null)
    importExport.listRollbackBackups.mockResolvedValue([backup])
    importExport.importMarkdownToDb.mockResolvedValue({ imported: 2, warnings: [] })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows an empty state without backups', async () => {
    importExport.listRollbackBackups.mockResolvedValue([])
    render(<BackupsSection onRestored={vi.fn()} />)

    expect(await screen.findByText('No backups yet.')).toBeVisible()
  })

  it('restores a backup after confirmation and marks it for upload', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
    const onRestored = vi.fn()
    render(<BackupsSection onRestored={onRestored} />)

    await userEvent.click(await screen.findByRole('button', { name: 'Restore' }))

    await waitFor(() => {
      expect(importExport.importMarkdownToDb).toHaveBeenCalledWith(backup.contentMd, {
        replace: true,
        markDirty: true,
        allowDestructiveReplace: true,
      })
    })
    expect(onRestored).toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('Backup restored.')
  })

  it('does not restore when the confirmation is canceled', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(false))
    render(<BackupsSection onRestored={vi.fn()} />)

    await userEvent.click(await screen.findByRole('button', { name: 'Restore' }))

    expect(importExport.importMarkdownToDb).not.toHaveBeenCalled()
  })
})
