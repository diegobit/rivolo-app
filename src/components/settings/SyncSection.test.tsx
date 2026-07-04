import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import SyncSection from './SyncSection'

const baseProps = {
  activeProvider: 'dropbox' as const,
  provider: 'dropbox' as const,
  summary: {
    connected: true,
    lastSync: 'Jun 21, 2026',
    remoteVersion: '42',
    dirty: true,
    account: 'A Person With A Long Name (person@example.com)',
    target: 'inbox.md',
  },
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

const summary = {
  connected: true,
  lastSync: 'Jun 21, 2026',
  remoteVersion: '42',
  dirty: true,
  account: 'A Person With A Long Name (person@example.com)',
  target: 'inbox.md',
}

describe('SyncSection', () => {
  it('shows an inactive connected provider without enabling sync actions', async () => {
    const activate = vi.fn()
    render(
      <SyncSection
        activeProvider="dropbox"
        provider="google-drive"
        summary={summary}
        online
        syncPaused={false}
        attention={null}
        targetDraft="inbox.md"
        targetDirty={false}
        syncBusy={false}
        status={null}
        onProviderChange={vi.fn()}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onActivate={activate}
        onTargetChange={vi.fn()}
        onSaveTarget={vi.fn()}
        onPull={vi.fn()}
        onPush={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Pull from Google Drive' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Use Google Drive for sync' }))
    expect(activate).toHaveBeenCalledOnce()
  })

  it('lists both providers while keeping the active provider visible', () => {
    render(
      <SyncSection
        activeProvider="google-drive"
        provider="google-drive"
        summary={summary}
        online
        syncPaused={false}
        attention={null}
        targetDraft="inbox.md"
        targetDirty={false}
        syncBusy={false}
        status="Google Drive is ready."
        onProviderChange={vi.fn()}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onActivate={vi.fn()}
        onTargetChange={vi.fn()}
        onSaveTarget={vi.fn()}
        onPull={vi.fn()}
        onPush={vi.fn()}
      />,
    )

    expect(screen.getByRole('option', { name: 'Dropbox' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Google Drive' })).toBeInTheDocument()
    expect(screen.getByText('Google Drive', { selector: 'div' })).toBeInTheDocument()
  })

  it('disables sync settings in a secondary tab', () => {
    render(
      <SyncSection
        activeProvider="dropbox"
        provider="dropbox"
        summary={summary}
        online
        syncPaused
        attention={null}
        targetDraft="inbox.md"
        targetDirty
        syncBusy={false}
        status={null}
        onProviderChange={vi.fn()}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onActivate={vi.fn()}
        onTargetChange={vi.fn()}
        onSaveTarget={vi.fn()}
        onPull={vi.fn()}
        onPush={vi.fn()}
      />,
    )

    expect(screen.getByText(/Tab sync: Paused in this tab/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pull from Dropbox' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Disconnect Dropbox' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('shows the automatic sync attention message', () => {
    render(
      <SyncSection
        activeProvider="dropbox"
        provider="dropbox"
        summary={summary}
        online
        syncPaused={false}
        attention="Dropbox changed remotely. Pull first, or use “Restore from local copy” to overwrite it."
        targetDraft="inbox.md"
        targetDirty={false}
        syncBusy={false}
        status={null}
        onProviderChange={vi.fn()}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onActivate={vi.fn()}
        onTargetChange={vi.fn()}
        onSaveTarget={vi.fn()}
        onPull={vi.fn()}
        onPush={vi.fn()}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Dropbox changed remotely.')
  })

  it('requires two clicks to overwrite: first arms, second confirms with force=true', async () => {
    const onPush = vi.fn()
    render(<SyncSection {...baseProps} onPush={onPush} />)

    const overwriteButton = screen.getByRole('button', { name: 'Restore from local copy' })
    await userEvent.click(overwriteButton)

    expect(onPush).not.toHaveBeenCalled()
    const confirmButton = screen.getByRole('button', { name: 'Confirm overwrite' })
    await userEvent.click(confirmButton)

    expect(onPush).toHaveBeenCalledExactlyOnceWith(true)
    expect(screen.getByRole('button', { name: 'Restore from local copy' })).toBeInTheDocument()
  })

  it('shows the offline disabled-hint under the action buttons', () => {
    render(<SyncSection {...baseProps} online={false} />)

    expect(screen.getByRole('button', { name: 'Pull from Dropbox' })).toBeDisabled()
    expect(screen.getByText("You're offline — sync actions are unavailable.")).toBeInTheDocument()
  })

  it('shows the not-connected disabled-hint under the action buttons', () => {
    render(
      <SyncSection
        {...baseProps}
        summary={{ ...baseProps.summary, connected: false }}
      />,
    )

    expect(screen.getByRole('button', { name: 'Pull from Dropbox' })).toBeDisabled()
    expect(screen.getByText('Connect Dropbox to enable sync actions.')).toBeInTheDocument()
  })
})
