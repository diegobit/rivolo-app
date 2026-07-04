import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import SyncSection from './SyncSection'
import type { SyncProviderSummary } from './SyncSection'

const connectedSummary: SyncProviderSummary = {
  connected: true,
  lastSync: 'Jun 21, 2026',
  remoteVersion: '42',
  dirty: true,
  account: 'A Person With A Long Name (person@example.com)',
  target: 'inbox.md',
}

const notConnectedSummary: SyncProviderSummary = {
  ...connectedSummary,
  connected: false,
}

const bothConnected = {
  dropbox: connectedSummary,
  'google-drive': connectedSummary,
}

const baseProps = {
  activeProvider: 'dropbox' as const,
  provider: 'dropbox' as const,
  summaries: bothConnected,
  online: true,
  syncPaused: false,
  attention: null,
  targetDraft: 'inbox.md',
  targetDirty: false,
  syncBusy: false,
  status: null,
  onProviderChange: vi.fn(),
  onConnect: vi.fn(),
  onDisconnect: vi.fn(),
  onActivate: vi.fn(),
  onTargetChange: vi.fn(),
  onSaveTarget: vi.fn(),
  onPull: vi.fn(),
  onPush: vi.fn(),
}

const openSyncRow = async (id: string) => {
  const header = screen
    .getAllByRole('button')
    .find((button) => button.getAttribute('aria-controls') === `sync-panel-${id}`)
  await userEvent.click(header!)
}

describe('SyncSection', () => {
  it('starts with both provider rows collapsed when no sync provider is active', () => {
    render(<SyncSection {...baseProps} activeProvider={null} />)

    const rowHeaders = screen
      .getAllByRole('button')
      .filter((button) => button.getAttribute('aria-controls')?.startsWith('sync-panel-'))
    expect(rowHeaders).toHaveLength(2)
    for (const header of rowHeaders) {
      expect(header).toHaveAttribute('aria-expanded', 'false')
    }
  })

  it('shows an inactive connected provider without enabling sync actions', async () => {
    const activate = vi.fn()
    render(
      <SyncSection
        {...baseProps}
        activeProvider="dropbox"
        provider="google-drive"
        onActivate={activate}
      />,
    )

    await openSyncRow('google-drive')
    expect(screen.getByRole('button', { name: 'Pull from Google Drive' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Use Google Drive for sync' }))
    expect(activate).toHaveBeenCalledOnce()
  })

  it('lists both providers with all rows collapsed on initial render', () => {
    render(<SyncSection {...baseProps} activeProvider="google-drive" provider="google-drive" />)

    const dropboxRow = screen
      .getAllByRole('button')
      .find((button) => button.getAttribute('aria-controls') === 'sync-panel-dropbox')
    const googleRow = screen
      .getAllByRole('button')
      .find((button) => button.getAttribute('aria-controls') === 'sync-panel-google-drive')

    expect(dropboxRow).toBeInTheDocument()
    expect(googleRow).toBeInTheDocument()
    expect(dropboxRow).toHaveAttribute('aria-expanded', 'false')
    expect(googleRow).toHaveAttribute('aria-expanded', 'false')
    // Both rows show a Connected badge.
    expect(screen.getAllByText('Connected')).toHaveLength(2)
  })

  it('taps a non-selected row to configure that provider', async () => {
    const onProviderChange = vi.fn()
    render(<SyncSection {...baseProps} provider="dropbox" onProviderChange={onProviderChange} />)

    const googleRow = screen
      .getAllByRole('button')
      .find((button) => button.getAttribute('aria-controls') === 'sync-panel-google-drive')
    await userEvent.click(googleRow!)
    expect(onProviderChange).toHaveBeenCalledExactlyOnceWith('google-drive')
  })

  it('disables sync settings in a secondary tab', async () => {
    render(
      <SyncSection
        {...baseProps}
        activeProvider="dropbox"
        provider="dropbox"
        syncPaused
        targetDirty
      />,
    )

    await openSyncRow('dropbox')
    expect(screen.getByText(/Tab sync: Paused in this tab/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pull from Dropbox' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Disconnect Dropbox' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('shows the automatic sync attention message', async () => {
    render(
      <SyncSection
        {...baseProps}
        attention="Dropbox changed remotely. Pull first, or use “Restore from local copy” to overwrite it."
      />,
    )

    await openSyncRow('dropbox')
    expect(screen.getByRole('alert')).toHaveTextContent('Dropbox changed remotely.')
  })

  it('requires two clicks to overwrite: first arms, second confirms with force=true (no window.confirm)', async () => {
    const onPush = vi.fn()
    render(<SyncSection {...baseProps} onPush={onPush} />)

    await openSyncRow('dropbox')
    const overwriteButton = screen.getByRole('button', {
      name: 'Restore from local copy',
    })
    await userEvent.click(overwriteButton)

    expect(onPush).not.toHaveBeenCalled()
    const confirmButton = screen.getByRole('button', {
      name: 'Confirm overwrite',
    })
    await userEvent.click(confirmButton)

    // A stray window.confirm (jsdom returns false by default) would block this call.
    expect(onPush).toHaveBeenCalledExactlyOnceWith(true)
    expect(screen.getByRole('button', { name: 'Restore from local copy' })).toBeInTheDocument()
  })

  it('shows the offline disabled-hint under the action buttons', async () => {
    render(<SyncSection {...baseProps} online={false} />)

    await openSyncRow('dropbox')
    expect(screen.getByRole('button', { name: 'Pull from Dropbox' })).toBeDisabled()
    expect(screen.getByText("You're offline — sync actions are unavailable.")).toBeInTheDocument()
  })

  it('shows the not-connected disabled-hint under the action buttons', async () => {
    render(
      <SyncSection
        {...baseProps}
        summaries={{
          dropbox: notConnectedSummary,
          'google-drive': notConnectedSummary,
        }}
      />,
    )

    await openSyncRow('dropbox')
    expect(screen.getByRole('button', { name: 'Pull from Dropbox' })).toBeDisabled()
    expect(screen.getByText('Connect Dropbox to enable sync actions.')).toBeInTheDocument()
  })
})
