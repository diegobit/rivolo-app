import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DataSection from './DataSection'

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

const renderSection = (overrides: Partial<React.ComponentProps<typeof DataSection>> = {}) => {
  const props: React.ComponentProps<typeof DataSection> = {
    exportFileName: 'inbox.md',
    importStatus: null,
    onImport: vi.fn(),
    onExport: vi.fn(),
    onRestored: vi.fn(),
    ...overrides,
  }
  render(<DataSection {...props} />)
  return props
}

describe('DataSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    coordinator.getTabSyncBlockReason.mockReturnValue(null)
    importExport.listRollbackBackups.mockResolvedValue([])
    importExport.importMarkdownToDb.mockResolvedValue({ imported: 2, warnings: [] })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows import and export without an empty backup panel', async () => {
    renderSection()

    expect(screen.getByRole('heading', { name: 'Data' })).toBeVisible()
    expect(screen.getByText('Import Markdown (.md)')).toBeVisible()
    expect(screen.getByText('Import or export Rivolo Markdown (.md) files.', { exact: false })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Export inbox.md' })).toBeVisible()
    await waitFor(() => expect(importExport.listRollbackBackups).toHaveBeenCalledOnce())
    expect(screen.queryByRole('button', { name: 'Local backups' })).not.toBeInTheDocument()
    expect(screen.queryByText('No backups yet.')).not.toBeInTheDocument()
  })

  it('restores a backup from the compact backup tools', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
    importExport.listRollbackBackups.mockResolvedValue([backup])
    const onRestored = vi.fn()
    renderSection({ onRestored })

    await userEvent.click(await screen.findByRole('button', { name: 'Local backups' }))
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }))

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

  it('keeps cloud version history inside backup tools', async () => {
    renderSection({
      cloudHistory: {
        provider: 'google-drive',
        fileName: 'inbox.md',
        url: 'https://drive.google.com/drive/folders/folder-1',
      },
    })

    await userEvent.click(await screen.findByRole('button', { name: 'Local backups' }))
    expect(screen.getByText(/Google Drive also keeps older versions of inbox\.md/)).toBeVisible()
    expect(screen.getByRole('link', { name: 'Drive folder' })).toHaveAttribute(
      'href',
      'https://drive.google.com/drive/folders/folder-1',
    )
  })
})
