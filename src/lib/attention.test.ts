import { describe, expect, it } from 'vitest'
import { buildAttentionItems } from './attention'
import { getSetupNotices } from './setupAttention'

describe('buildAttentionItems', () => {
  it('builds the shared Timeline and Settings attention list in priority order', () => {
    const setupNotices = getSetupNotices({
      aiNeedsSetup: true,
      syncNeedsSetup: true,
      dismissed: { ai: false, sync: false },
    })

    const items = buildAttentionItems({
      persistFailureMessage: 'Local database write failed.',
      syncAttentionMessage: 'Google Drive changed remotely.',
      setupNotices,
    })

    expect(items.map((item) => item.id)).toEqual([
      'persist-attention',
      'sync-attention',
      'ai',
      'sync',
    ])
    expect(items.find((item) => item.id === 'persist-attention')).toMatchObject({
      settingsSectionId: 'settings-data',
    })
    expect(items.find((item) => item.id === 'persist-attention')?.dismissibleSetupNoticeId).toBeUndefined()
    expect(items.find((item) => item.id === 'sync-attention')).toMatchObject({
      settingsSectionId: 'settings-sync',
    })
    expect(items.find((item) => item.id === 'sync-attention')?.dismissibleSetupNoticeId).toBeUndefined()
    expect(items.find((item) => item.id === 'sync')).toMatchObject({
      settingsSectionId: 'settings-sync',
      dismissibleSetupNoticeId: 'sync',
    })
  })

  it('omits inactive runtime attention items', () => {
    expect(
      buildAttentionItems({
        persistFailureMessage: null,
        syncAttentionMessage: null,
        setupNotices: [],
      }),
    ).toEqual([])
  })
})
