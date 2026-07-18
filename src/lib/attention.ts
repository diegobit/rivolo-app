import type { SetupNotice, SetupNoticeId } from './setupAttention'

export type AttentionItem = {
  id: string
  title: string
  description: string
  settingsSectionId: 'settings-ai' | 'settings-sync' | 'settings-data'
  dismissibleSetupNoticeId?: SetupNoticeId
}

type BuildAttentionItemsOptions = {
  persistFailureMessage: string | null
  syncAttentionMessage: string | null
  setupNotices: SetupNotice[]
}

export const buildAttentionItems = ({
  persistFailureMessage,
  syncAttentionMessage,
  setupNotices,
}: BuildAttentionItemsOptions): AttentionItem[] => [
  ...(persistFailureMessage
    ? [
        {
          id: 'persist-attention',
          title: "Notes aren't saving",
          description: persistFailureMessage,
          settingsSectionId: 'settings-data' as const,
        },
      ]
    : []),
  ...(syncAttentionMessage
    ? [
        {
          id: 'sync-attention',
          title: 'Sync needs attention',
          description: syncAttentionMessage,
          settingsSectionId: 'settings-sync' as const,
        },
      ]
    : []),
  ...setupNotices.map((notice) => ({
    ...notice,
    dismissibleSetupNoticeId: notice.id,
  })),
]
