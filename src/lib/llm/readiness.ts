import type { LlmProviderId, LlmProviderSettings, LlmSecrets } from './types'

export const isProviderReady = (
  id: LlmProviderId,
  providerSettings: LlmProviderSettings,
  llmSecrets: LlmSecrets,
): boolean => {
  if (llmSecrets[id]?.apiKey) return true
  if (id === 'openai-compatible') {
    const settings = providerSettings['openai-compatible']
    return Boolean(settings.model && settings.baseUrl)
  }
  return false
}
