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
        allowUnsafeImport: true,
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

  it('shows no cloud version history note when no provider is connected', async () => {
    render(<BackupsSection onRestored={vi.fn()} />)

    await screen.findByRole('button', { name: 'Restore' })
    expect(screen.queryByText(/version history/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/manage versions/i)).not.toBeInTheDocument()
  })

  it('points to Dropbox version history when Dropbox is the active provider', async () => {
    render(
      <BackupsSection
        onRestored={vi.fn()}
        cloudHistory={{ provider: 'dropbox', fileName: 'inbox.md', url: 'https://www.dropbox.com/home' }}
      />,
    )

    expect(await screen.findByText(/Dropbox also keeps older versions of inbox\.md/)).toBeVisible()
    expect(screen.getByRole('link', { name: 'dropbox.com' })).toHaveAttribute(
      'href',
      'https://www.dropbox.com/home',
    )
  })

  it('points to Google Drive manage versions when Drive is the active provider', async () => {
    render(
      <BackupsSection
        onRestored={vi.fn()}
        cloudHistory={{
          provider: 'google-drive',
          fileName: 'inbox.md',
          url: 'https://drive.google.com/drive/folders/folder-1',
        }}
      />,
    )

    expect(await screen.findByText(/Google Drive also keeps older versions of inbox\.md/)).toBeVisible()
    expect(screen.getByRole('link', { name: 'Drive folder' })).toHaveAttribute(
      'href',
      'https://drive.google.com/drive/folders/folder-1',
    )
  })
})
