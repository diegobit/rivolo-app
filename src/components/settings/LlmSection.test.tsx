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

const openLlmRow = async (id: string) => {
  const header = screen
    .getAllByRole('button')
    .find((button) => button.getAttribute('aria-controls') === `llm-panel-${id}`)
  await userEvent.click(header!)
}

describe('LlmSection', () => {
  it('starts with every provider row collapsed when the active provider is not configured', () => {
    renderSection({ llmSecrets: {} })

    expect(screen.queryByRole('switch', { name: 'Web search' })).not.toBeInTheDocument()
    expect(screen.queryByText('Reply language')).not.toBeInTheDocument()
    const rowHeaders = screen
      .getAllByRole('button')
      .filter((button) => button.getAttribute('aria-controls')?.startsWith('llm-panel-'))
    expect(rowHeaders).toHaveLength(4)
    for (const header of rowHeaders) {
      expect(header).toHaveAttribute('aria-expanded', 'false')
    }
  })

  it('keeps native provider tuning out of the normal setup row', async () => {
    renderSection()

    await openLlmRow('gemini')
    expect(screen.queryByRole('switch', { name: 'Web search' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Model')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Thinking level')).not.toBeInTheDocument()
    expect(screen.getByText('API key saved')).toBeInTheDocument()
  })

  it('keeps OpenAI-compatible required fields in normal setup', async () => {
    renderSection()

    await openLlmRow('openai-compatible')
    expect(screen.getByLabelText('Base URL')).toBeInTheDocument()
    expect(screen.getByLabelText('Model')).toBeInTheDocument()
    expect(screen.getByText('API key (optional)')).toBeInTheDocument()
  })

  it('toggles web search immediately in advanced mode', async () => {
    const onAllowWebSearchChange = vi.fn()
    renderSection({ advanced: true, onAllowWebSearchChange })

    await openLlmRow('gemini')
    await userEvent.click(screen.getByRole('switch', { name: 'Web search' }))
    expect(onAllowWebSearchChange).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('saves the gemini thinking level immediately with the merged object in advanced mode', async () => {
    const onSaveProviderSettings = vi.fn()
    renderSection({ advanced: true, onSaveProviderSettings })

    await openLlmRow('gemini')
    await userEvent.selectOptions(screen.getByLabelText('Thinking level'), 'high')
    expect(onSaveProviderSettings).toHaveBeenCalledExactlyOnceWith('gemini', {
      model: 'gemini-3-flash-preview',
      reasoning: { thinkingLevel: 'high' },
      allowThinking: true,
    })
  })

  it('commits the native provider model on blur in advanced mode', async () => {
    const onSaveProviderSettings = vi.fn()
    renderSection({ advanced: true, onSaveProviderSettings })

    await openLlmRow('gemini')
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

  it('reverts a blank advanced model and shows an error', async () => {
    const onSaveProviderSettings = vi.fn()
    renderSection({ advanced: true, onSaveProviderSettings })

    await openLlmRow('gemini')
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

    // Gemini is active but collapsed; no activation button should be present.
    expect(screen.queryByRole('button', { name: 'Use Gemini' })).not.toBeInTheDocument()

    // Expand Anthropic, which has a saved key and is therefore ready.
    await openLlmRow('anthropic')
    const useButton = screen.getByRole('button', { name: 'Use Claude' })
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

  it('shows the saved-key state with Replace and Remove instead of an input', async () => {
    const llmSecrets: LlmSecrets = { gemini: { apiKey: 'sk-test' } }
    renderSection({ provider: 'gemini', llmSecrets })

    await openLlmRow('gemini')
    expect(screen.getByText('API key saved')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Replace key…' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove key' })).toBeInTheDocument()
    expect(screen.queryByLabelText(/^API key/)).not.toBeInTheDocument()
  })

  it('commits the custom reply language from advanced mode on blur, not on each keystroke', async () => {
    const onAiLanguageChange = vi.fn()
    renderSection({ aiLanguage: 'follow', advanced: true, onAiLanguageChange })

    await userEvent.click(screen.getByRole('button', { name: 'Custom' }))
    const input = screen.getByPlaceholderText('e.g. Italian, English...')
    await userEvent.type(input, 'Italian')
    expect(onAiLanguageChange).not.toHaveBeenCalled()
    await userEvent.tab()
    expect(onAiLanguageChange).toHaveBeenCalledExactlyOnceWith('Italian')
  })

  it('merges basic and advanced controls into one row in advanced mode', async () => {
    renderSection({ advanced: true, provider: 'anthropic' })

    const rowHeaders = screen
      .getAllByRole('button')
      .filter((button) => button.getAttribute('aria-controls')?.startsWith('llm-panel-'))
    expect(rowHeaders).toHaveLength(4)
    expect(screen.getByText('Reply language')).toBeInTheDocument()

    await openLlmRow('gemini')
    expect(screen.getByLabelText('Model')).toBeInTheDocument()
    expect(screen.getByLabelText('Thinking level')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Web search' })).toBeInTheDocument()
    expect(screen.getByText('API key saved')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use Gemini' })).toBeInTheDocument()
  })
})
