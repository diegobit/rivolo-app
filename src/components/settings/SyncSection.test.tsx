import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import SyncSection from './SyncSection'

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
})
