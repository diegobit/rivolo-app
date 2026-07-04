export type SetupNoticeId = 'ai' | 'sync'

export type DismissedSetupNotices = Record<SetupNoticeId, boolean>

export type SetupNotice = {
  id: SetupNoticeId
  title: string
  description: string
  settingsSectionId: 'settings-ai' | 'settings-sync'
}

export const DEFAULT_DISMISSED_SETUP_NOTICES: DismissedSetupNotices = {
  ai: false,
  sync: false,
}

const SETUP_NOTICES: Record<SetupNoticeId, SetupNotice> = {
  ai: {
    id: 'ai',
    title: "AI assistant isn't set up",
    description: 'Open a provider and add an API key.',
    settingsSectionId: 'settings-ai',
  },
  sync: {
    id: 'sync',
    title: 'Cloud sync is off',
    description: 'Your notes are stored only on this device.',
    settingsSectionId: 'settings-sync',
  },
}

type GetSetupNoticesOptions = {
  aiNeedsSetup: boolean
  syncNeedsSetup: boolean
  dismissed: DismissedSetupNotices
}

export const getSetupNotices = ({
  aiNeedsSetup,
  syncNeedsSetup,
  dismissed,
}: GetSetupNoticesOptions): SetupNotice[] => {
  const notices: SetupNotice[] = []
  if (aiNeedsSetup && !dismissed.ai) notices.push(SETUP_NOTICES.ai)
  if (syncNeedsSetup && !dismissed.sync) notices.push(SETUP_NOTICES.sync)
  return notices
}
