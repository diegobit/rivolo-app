import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import LlmSection from './LlmSection'
import {
  DEFAULT_LLM_PROVIDER_SETTINGS,
  type LlmProviderSettings,
  type LlmSecrets,
} from '../../lib/llm/types'

const baseProviderSettings: LlmProviderSettings = {
  ...DEFAULT_LLM_PROVIDER_SETTINGS,
  gemini: {
    model: 'gemini-3-flash-preview',
    reasoning: { thinkingLevel: 'minimal' },
    allowThinking: false,
  },
}

type Overrides = Partial<React.ComponentProps<typeof LlmSection>>

const renderSection = (overrides: Overrides = {}) => {
  const props: React.ComponentProps<typeof LlmSection> = {
    provider: 'gemini',
    providerSettings: baseProviderSettings,
    // The active provider is configured, so its row starts expanded.
    llmSecrets: { gemini: { apiKey: 'sk-test' } },
    aiLanguage: 'follow',
    allowWebSearch: true,
    settingsError: null,
    onSelectProvider: vi.fn(),
    onSaveProviderSettings: vi.fn(),
    onSaveProviderKey: vi.fn(),
    onClearProviderKey: vi.fn(),
    onFollowLanguage: vi.fn(),
    onAiLanguageChange: vi.fn(),
    onAllowWebSearchChange: vi.fn(),
    ...overrides,
  }
  render(<LlmSection {...props} />)
  return props
}

describe('LlmSection', () => {
  it('starts with every provider row collapsed when the active provider is not configured', () => {
    renderSection({ llmSecrets: {} })

    expect(screen.queryByRole('switch', { name: 'Web search' })).not.toBeInTheDocument()
    const rowHeaders = screen
      .getAllByRole('button')
      .filter((button) => button.getAttribute('aria-controls')?.startsWith('llm-panel-'))
    expect(rowHeaders).toHaveLength(4)
    for (const header of rowHeaders) {
      expect(header).toHaveAttribute('aria-expanded', 'false')
    }
  })

  it('toggles web search immediately', async () => {
    const onAllowWebSearchChange = vi.fn()
    renderSection({ onAllowWebSearchChange })

    await userEvent.click(screen.getByRole('switch', { name: 'Web search' }))
    expect(onAllowWebSearchChange).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('saves the gemini thinking level immediately with the merged object', async () => {
    const onSaveProviderSettings = vi.fn()
    renderSection({ onSaveProviderSettings })

    await userEvent.selectOptions(screen.getByLabelText('Thinking level'), 'high')
    expect(onSaveProviderSettings).toHaveBeenCalledExactlyOnceWith('gemini', {
      model: 'gemini-3-flash-preview',
      reasoning: { thinkingLevel: 'high' },
      allowThinking: true,
    })
  })

  it('commits the model on blur', async () => {
    const onSaveProviderSettings = vi.fn()
    renderSection({ onSaveProviderSettings })

    const input = screen.getByLabelText('Model')
    await userEvent.clear(input)
    await userEvent.type(input, 'gemini-3-pro-preview')
    await userEvent.tab()

    expect(onSaveProviderSettings).toHaveBeenCalledExactlyOnceWith('gemini', {
      model: 'gemini-3-pro-preview',
      reasoning: { thinkingLevel: 'minimal' },
      allowThinking: false,
    })
  })

  it('reverts a blank model and shows an error', async () => {
    const onSaveProviderSettings = vi.fn()
    renderSection({ onSaveProviderSettings })

    const input = screen.getByLabelText('Model') as HTMLInputElement
    await userEvent.clear(input)
    await userEvent.tab()

    expect(onSaveProviderSettings).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('Model ID is required.')
    expect(input.value).toBe('gemini-3-flash-preview')
  })

  it('shows "Use {label}" only for non-active providers and activates when ready', async () => {
    const onSelectProvider = vi.fn()
    const llmSecrets: LlmSecrets = { anthropic: { apiKey: 'sk-test' } }
    renderSection({ provider: 'gemini', llmSecrets, onSelectProvider })

    // The active provider (gemini, open by default) has no activation button.
    expect(screen.queryByRole('button', { name: 'Use Gemini' })).not.toBeInTheDocument()

    // Expand Anthropic, which has a saved key and is therefore ready.
    const anthropicHeader = screen
      .getAllByRole('button')
      .find((button) => button.getAttribute('aria-controls') === 'llm-panel-anthropic')
    await userEvent.click(anthropicHeader!)
    const useButton = screen.getByRole('button', { name: 'Use Claude (Anthropic)' })
    expect(useButton).toBeEnabled()
    await userEvent.click(useButton)
    expect(onSelectProvider).toHaveBeenCalledExactlyOnceWith('anthropic')
  })

  it('disables activation and shows a hint when a provider is not ready', async () => {
    renderSection({ provider: 'gemini', llmSecrets: {} })

    const openaiHeader = screen
      .getAllByRole('button')
      .find((button) => button.getAttribute('aria-controls') === 'llm-panel-openai')
    await userEvent.click(openaiHeader!)
    expect(screen.getByRole('button', { name: 'Use OpenAI' })).toBeDisabled()
    expect(screen.getByText('Add an API key to activate.')).toBeInTheDocument()
  })

  it('shows the saved-key state with Replace and Remove instead of an input', () => {
    const llmSecrets: LlmSecrets = { gemini: { apiKey: 'sk-test' } }
    renderSection({ provider: 'gemini', llmSecrets })

    expect(screen.getByText('API key saved')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Replace key…' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove key' })).toBeInTheDocument()
    expect(screen.queryByLabelText(/^API key/)).not.toBeInTheDocument()
  })

  it('commits the custom reply language on blur, not on each keystroke', async () => {
    const onAiLanguageChange = vi.fn()
    renderSection({ aiLanguage: 'follow', onAiLanguageChange })

    await userEvent.click(screen.getByRole('button', { name: 'Custom' }))
    const input = screen.getByPlaceholderText('e.g. Italian, English...')
    await userEvent.type(input, 'Italian')
    expect(onAiLanguageChange).not.toHaveBeenCalled()
    await userEvent.tab()
    expect(onAiLanguageChange).toHaveBeenCalledExactlyOnceWith('Italian')
  })
})
