import { create } from 'zustand'
import { decryptWithPasscode, encryptWithPasscode } from '../lib/crypto'
import { getDropboxState, updateDropboxState } from '../lib/dropboxState'
import { getJsonSetting, getSetting, setJsonSetting, setSetting } from '../lib/settingsRepository'
import type { EncryptedPayload } from '../lib/crypto'

type Provider = 'gemini'

type TimelineView = 'full' | 'preview'

type LlmSecrets = {
  geminiApiKey: string
}

const DEFAULT_PASSCODE = '0000'

type SettingsState = {
  provider: Provider
  geminiApiKey: string | null
  encrypted: EncryptedPayload | null
  locked: boolean
  loading: boolean
  passcode: string
  timelineView: TimelineView
  loadSettings: () => Promise<void>
  saveGeminiKey: (apiKey: string) => Promise<void>
  updatePasscode: (passcode: string) => Promise<boolean>
  updateTimelineView: (view: TimelineView) => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  provider: 'gemini',
  geminiApiKey: null,
  encrypted: null,
  locked: false,
  loading: false,
  passcode: DEFAULT_PASSCODE,
  timelineView: 'full',

  loadSettings: async () => {
    set({ loading: true })
    const provider = (await getSetting('llm.provider')) as Provider | null
    const storedPasscode = await getSetting('llm.passcode')
    const storedTimelineView = (await getSetting('timeline.view')) as TimelineView | null
    const passcode = storedPasscode ?? DEFAULT_PASSCODE
    const timelineView = storedTimelineView ?? 'full'
    if (!storedPasscode) {
      await setSetting('llm.passcode', passcode)
    }
    if (!storedTimelineView) {
      await setSetting('timeline.view', timelineView)
    }

    const encrypted = await getJsonSetting<EncryptedPayload>('llm.encrypted')
    let geminiApiKey: string | null = null
    let locked = false

    if (encrypted) {
      try {
        const decrypted = await decryptWithPasscode(passcode, encrypted)
        const secrets = JSON.parse(decrypted) as LlmSecrets
        geminiApiKey = secrets.geminiApiKey
      } catch {
        locked = true
      }
    }

    set({
      provider: provider ?? 'gemini',
      passcode,
      encrypted,
      geminiApiKey,
      locked,
      timelineView,
      loading: false,
    })
  },

  saveGeminiKey: async (apiKey: string) => {
    const passcode = get().passcode || DEFAULT_PASSCODE
    const payload = await encryptWithPasscode(passcode, JSON.stringify({ geminiApiKey: apiKey }))
    await setJsonSetting('llm.encrypted', payload)
    await setSetting('llm.provider', 'gemini')
    await setSetting('llm.passcode', passcode)
    set({ encrypted: payload, geminiApiKey: apiKey, locked: false, provider: 'gemini' })
  },

  updatePasscode: async (nextPasscode: string) => {
    const normalized = nextPasscode.trim() || DEFAULT_PASSCODE
    const currentPasscode = get().passcode || DEFAULT_PASSCODE
    const encrypted = await getJsonSetting<EncryptedPayload>('llm.encrypted')
    let nextEncrypted = encrypted
    let locked = false
    let geminiApiKey = get().geminiApiKey

    if (encrypted) {
      try {
        const decrypted = await decryptWithPasscode(currentPasscode, encrypted)
        const secrets = JSON.parse(decrypted) as LlmSecrets
        nextEncrypted = await encryptWithPasscode(normalized, JSON.stringify(secrets))
        await setJsonSetting('llm.encrypted', nextEncrypted)
        geminiApiKey = secrets.geminiApiKey
      } catch {
        locked = true
        geminiApiKey = null
      }
    }

    const dropboxState = await getDropboxState()
    if (dropboxState.encryptedAuth) {
      try {
        const decryptedAuth = await decryptWithPasscode(currentPasscode, dropboxState.encryptedAuth)
        const nextEncryptedAuth = await encryptWithPasscode(normalized, decryptedAuth)
        await updateDropboxState({ encryptedAuth: nextEncryptedAuth })
      } catch {
        // Keep existing Dropbox token; user can re-save if needed.
      }
    }

    await setSetting('llm.passcode', normalized)
    set({
      passcode: normalized,
      encrypted: nextEncrypted ?? null,
      locked,
      geminiApiKey,
    })

    return !locked
  },

  updateTimelineView: async (view: TimelineView) => {
    await setSetting('timeline.view', view)
    set({ timelineView: view })
  },
}))
