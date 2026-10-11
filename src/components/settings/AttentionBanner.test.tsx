import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { buildAttentionItems } from '../../lib/attention'
import { DEFAULT_DISMISSED_SETUP_NOTICES, getSetupNotices } from '../../lib/setupAttention'
import AttentionBanner from './AttentionBanner'

const setupNotices = () => getSetupNotices({
  aiNeedsSetup: true,
  syncNeedsSetup: true,
  dismissed: DEFAULT_DISMISSED_SETUP_NOTICES,
})

describe('AttentionBanner', () => {
  it('renders runtime attention as a non-dismissible Settings banner', async () => {
    const onOpen = vi.fn()
    const items = buildAttentionItems({
      persistFailureMessage: 'Local database write failed.',
      syncAttentionMessage: 'Google Drive changed remotely.',
      setupNotices: setupNotices(),
    })
    expect(items.map(item => item.id)).toEqual(['persist-attention', 'sync-attention', 'ai', 'sync'])
    expect(items[0].settingsSectionId).toBe('settings-data')
    expect(items[1].settingsSectionId).toBe('settings-sync')
    for (const item of items.slice(0, 2)) {
      expect(item.dismissibleSetupNoticeId).toBeUndefined()
    }
    render(<AttentionBanner item={items[1]} onOpen={onOpen} />)

    expect(screen.getByText('Sync needs attention')).toBeVisible()
    expect(screen.getByText('Google Drive changed remotely.')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Dismiss Sync needs attention' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Open Sync needs attention' }))
    expect(onOpen).toHaveBeenCalledOnce()
  })

  it('keeps setup reminders dismissible', async () => {
    const onDismiss = vi.fn()
    const items = buildAttentionItems({
      persistFailureMessage: null,
      syncAttentionMessage: null,
      setupNotices: setupNotices(),
    })
    expect(items.map(item => item.id)).toEqual(['ai', 'sync'])
    const setupAttention = items[1]
    expect(setupAttention).toMatchObject({ settingsSectionId: 'settings-sync', dismissibleSetupNoticeId: 'sync' })

    render(<AttentionBanner item={setupAttention} onOpen={vi.fn()} onDismiss={onDismiss} />)
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss Cloud sync is off' }))

    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('omits inactive runtime warnings and configured or dismissed setup reminders', () => {
    expect(buildAttentionItems({
      persistFailureMessage: null,
      syncAttentionMessage: null,
      setupNotices: getSetupNotices({
        aiNeedsSetup: true,
        syncNeedsSetup: false,
        dismissed: { ai: true, sync: false },
      }),
    })).toEqual([])
  })
})
