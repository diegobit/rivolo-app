import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AttentionItem } from '../../lib/attention'
import AttentionBanner from './AttentionBanner'

const syncAttention: AttentionItem = {
  id: 'sync-attention',
  title: 'Sync needs attention',
  description: 'Google Drive changed remotely.',
  settingsSectionId: 'settings-sync',
}

describe('AttentionBanner', () => {
  it('renders runtime attention as a non-dismissible Settings banner', async () => {
    const onOpen = vi.fn()
    render(<AttentionBanner item={syncAttention} onOpen={onOpen} />)

    expect(screen.getByText('Sync needs attention')).toBeVisible()
    expect(screen.getByText('Google Drive changed remotely.')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Dismiss Sync needs attention' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Open Sync needs attention' }))
    expect(onOpen).toHaveBeenCalledOnce()
  })

  it('keeps setup reminders dismissible', async () => {
    const onDismiss = vi.fn()
    const setupAttention: AttentionItem = {
      id: 'sync',
      title: 'Cloud sync is off',
      description: 'Everything stays on this device.',
      settingsSectionId: 'settings-sync',
      dismissibleSetupNoticeId: 'sync',
    }

    render(<AttentionBanner item={setupAttention} onOpen={vi.fn()} onDismiss={onDismiss} />)
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss Cloud sync is off' }))

    expect(onDismiss).toHaveBeenCalledOnce()
  })
})
