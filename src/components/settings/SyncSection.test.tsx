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
  showForcePull: false,
  showForcePush: false,
  onProviderChange: vi.fn(),
  onConnect: vi.fn(),
  onDisconnect: vi.fn(),
  onActivate: vi.fn(),
  onTargetChange: vi.fn(),
  onSaveTarget: vi.fn(),
  onPull: vi.fn(),
  onForcePull: vi.fn(),
  onPush: vi.fn(),
}

const USE_CLOUD_LABEL = 'Use cloud version — replaces notes on this device'
const KEEP_LOCAL_LABEL = "Keep this device's notes — replaces the cloud copy"

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
    expect(screen.queryByRole('button', { name: 'Pull from Google Drive' })).not.toBeInTheDocument()
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
    expect(screen.getByText(/Auto-sync and sync settings are paused/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pull from Dropbox' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Disconnect Dropbox' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })

  it('shows the automatic sync attention message', async () => {
    render(
      <SyncSection {...baseProps} attention="Dropbox changed remotely. Choose which copy to keep." />,
    )

    await openSyncRow('dropbox')
    expect(screen.getByRole('alert')).toHaveTextContent('Dropbox changed remotely.')
  })

  it('shows both recovery actions inside the attention alert in Basic mode', async () => {
    // Even with both force reveals requested, Basic mode never renders the
    // standalone Advanced actions — the alert is the only recovery surface.
    render(
      <SyncSection
        {...baseProps}
        attention="Dropbox changed remotely. Choose which copy to keep."
        showForcePull
        showForcePush
      />,
    )

    await openSyncRow('dropbox')
    expect(screen.getByRole('button', { name: USE_CLOUD_LABEL })).toBeEnabled()
    expect(screen.getByRole('button', { name: KEEP_LOCAL_LABEL })).toBeEnabled()
    // Basic mode still shows none of the standalone Advanced actions.
    expect(screen.queryByRole('button', { name: 'Pull from Dropbox' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Push to Dropbox' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Force pull (overwrite local)' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Force push (overwrite remote)' }),
    ).not.toBeInTheDocument()
  })

  it('shows no sync action buttons in Basic mode while sync is healthy', async () => {
    render(<SyncSection {...baseProps} attention={null} />)

    await openSyncRow('dropbox')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: USE_CLOUD_LABEL })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: KEEP_LOCAL_LABEL })).not.toBeInTheDocument()
  })

  it('arms then confirms the in-alert cloud-version action to force pull (Basic mode)', async () => {
    const onForcePull = vi.fn()
    render(
      <SyncSection
        {...baseProps}
        attention="Dropbox changed remotely. Choose which copy to keep."
        onForcePull={onForcePull}
      />,
    )

    await openSyncRow('dropbox')
    await userEvent.click(screen.getByRole('button', { name: USE_CLOUD_LABEL }))
    expect(onForcePull).not.toHaveBeenCalled()

    await userEvent.click(
      screen.getByRole('button', { name: 'Confirm — replace notes on this device' }),
    )
    expect(onForcePull).toHaveBeenCalledOnce()
  })

  it('arms then confirms the in-alert keep-local action to force push (Basic mode)', async () => {
    const onPush = vi.fn()
    render(
      <SyncSection
        {...baseProps}
        attention="Dropbox changed remotely. Choose which copy to keep."
        onPush={onPush}
      />,
    )

    await openSyncRow('dropbox')
    await userEvent.click(screen.getByRole('button', { name: KEEP_LOCAL_LABEL }))
    expect(onPush).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Confirm — replace the cloud copy' }))
    expect(onPush).toHaveBeenCalledExactlyOnceWith(true)
  })

  it('shows the in-alert recovery actions in Advanced mode too', async () => {
    // Pull-side attention: the alert keeps both recovery actions, and the
    // matching force action joins the manual row.
    render(
      <SyncSection
        {...baseProps}
        advanced
        attention="Dropbox changed remotely. Choose which copy to keep."
        showForcePull
      />,
    )

    await openSyncRow('dropbox')
    expect(screen.getByRole('button', { name: USE_CLOUD_LABEL })).toBeEnabled()
    expect(screen.getByRole('button', { name: KEEP_LOCAL_LABEL })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Force pull (overwrite local)' })).toBeEnabled()
    expect(
      screen.queryByRole('button', { name: 'Force push (overwrite remote)' }),
    ).not.toBeInTheDocument()
  })

  it('adds advanced target and, while healthy, exactly Pull and Push alongside the basic controls', async () => {
    render(<SyncSection {...baseProps} advanced />)

    await openSyncRow('dropbox')
    // Basic controls remain (superset).
    expect(screen.getByText(/Account:/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Disconnect Dropbox' })).toBeInTheDocument()
    // Advanced controls are added.
    expect(screen.getByText(/Tab sync: Primary tab/)).toBeInTheDocument()
    expect(screen.getByLabelText('Dropbox path')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pull from Dropbox' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Push to Dropbox' })).toBeEnabled()
    // Healthy sync keeps the destructive actions hidden.
    expect(
      screen.queryByRole('button', { name: 'Force pull (overwrite local)' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Force push (overwrite remote)' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Restore from local copy' })).not.toBeInTheDocument()
  })

  it('reveals Force push while a push is blocked and hides it once cleared', async () => {
    const { rerender } = render(<SyncSection {...baseProps} advanced showForcePush />)

    await openSyncRow('dropbox')
    expect(screen.getByRole('button', { name: 'Force push (overwrite remote)' })).toBeEnabled()
    expect(
      screen.queryByRole('button', { name: 'Force pull (overwrite local)' }),
    ).not.toBeInTheDocument()

    rerender(<SyncSection {...baseProps} advanced />)
    expect(
      screen.queryByRole('button', { name: 'Force push (overwrite remote)' }),
    ).not.toBeInTheDocument()
  })

  it('reveals Force pull while a pull is refused and hides it once cleared', async () => {
    const { rerender } = render(<SyncSection {...baseProps} advanced showForcePull />)

    await openSyncRow('dropbox')
    expect(screen.getByRole('button', { name: 'Force pull (overwrite local)' })).toBeEnabled()
    expect(
      screen.queryByRole('button', { name: 'Force push (overwrite remote)' }),
    ).not.toBeInTheDocument()

    rerender(<SyncSection {...baseProps} advanced />)
    expect(
      screen.queryByRole('button', { name: 'Force pull (overwrite local)' }),
    ).not.toBeInTheDocument()
  })

  it('wires Pull and Push to their non-force handlers', async () => {
    const onPull = vi.fn()
    const onPush = vi.fn()
    render(<SyncSection {...baseProps} advanced onPull={onPull} onPush={onPush} />)

    await openSyncRow('dropbox')
    await userEvent.click(screen.getByRole('button', { name: 'Pull from Dropbox' }))
    expect(onPull).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByRole('button', { name: 'Push to Dropbox' }))
    expect(onPush).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('requires two clicks to force push: first arms, second confirms with force=true (no window.confirm)', async () => {
    const onPush = vi.fn()
    render(<SyncSection {...baseProps} advanced showForcePush onPush={onPush} />)

    await openSyncRow('dropbox')
    await userEvent.click(screen.getByRole('button', { name: 'Force push (overwrite remote)' }))

    expect(onPush).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Confirm force push' }))

    // A stray window.confirm (jsdom returns false by default) would block this call.
    expect(onPush).toHaveBeenCalledExactlyOnceWith(true)
    expect(screen.getByRole('button', { name: 'Force push (overwrite remote)' })).toBeInTheDocument()
  })

  it('requires two clicks to force pull: first arms, second confirms', async () => {
    const onForcePull = vi.fn()
    render(<SyncSection {...baseProps} advanced showForcePull onForcePull={onForcePull} />)

    await openSyncRow('dropbox')
    await userEvent.click(screen.getByRole('button', { name: 'Force pull (overwrite local)' }))

    expect(onForcePull).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Confirm force pull' }))

    expect(onForcePull).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Force pull (overwrite local)' })).toBeInTheDocument()
  })

  it('arming one destructive action disarms the other', async () => {
    const onForcePull = vi.fn()
    const onPush = vi.fn()
    render(
      <SyncSection
        {...baseProps}
        advanced
        showForcePull
        showForcePush
        onForcePull={onForcePull}
        onPush={onPush}
      />,
    )

    await openSyncRow('dropbox')
    await userEvent.click(screen.getByRole('button', { name: 'Force pull (overwrite local)' }))
    expect(screen.getByRole('button', { name: 'Confirm force pull' })).toBeInTheDocument()

    // Arming force push re-labels force pull back to idle; nothing runs.
    await userEvent.click(screen.getByRole('button', { name: 'Force push (overwrite remote)' }))
    expect(screen.getByRole('button', { name: 'Force pull (overwrite local)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm force push' })).toBeInTheDocument()
    expect(onForcePull).not.toHaveBeenCalled()
    expect(onPush).not.toHaveBeenCalled()
  })

  it('shows the offline disabled-hint under the advanced action buttons', async () => {
    render(<SyncSection {...baseProps} advanced online={false} />)

    await openSyncRow('dropbox')
    expect(screen.getByRole('button', { name: 'Pull from Dropbox' })).toBeDisabled()
    expect(screen.getByText("You're offline — sync actions are unavailable.")).toBeInTheDocument()
  })

  it('shows the not-connected disabled-hint under the advanced action buttons', async () => {
    render(
      <SyncSection
        {...baseProps}
        advanced
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
