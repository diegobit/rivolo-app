import { describe, expect, it } from 'vitest'
import { DEFAULT_DISMISSED_SETUP_NOTICES, getSetupNotices } from './setupAttention'

describe('getSetupNotices', () => {
  it('returns both setup notices for a new user', () => {
    const notices = getSetupNotices({
      aiNeedsSetup: true,
      syncNeedsSetup: true,
      dismissed: DEFAULT_DISMISSED_SETUP_NOTICES,
    })

    expect(notices.map((notice) => notice.id)).toEqual(['ai', 'sync'])
  })

  it('excludes configured or dismissed notices', () => {
    const notices = getSetupNotices({
      aiNeedsSetup: true,
      syncNeedsSetup: false,
      dismissed: { ai: true, sync: false },
    })

    expect(notices).toEqual([])
  })
})
