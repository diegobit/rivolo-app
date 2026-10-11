import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Timeline from './Timeline'
import { DEFAULT_LLM_PROVIDER_SETTINGS } from '../lib/llm/types'
import { useChatStore } from '../store/useChatStore'
import { useUIStore } from '../store/useUIStore'

const installMatchMedia = (matches: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  })
})

const stores = vi.hoisted(() => ({
  settings: {
    loadSettings: vi.fn().mockResolvedValue(undefined),
    provider: 'gemini',
    providerSettings: {},
    llmSecrets: {} as Record<string, { apiKey?: string }>,
    allowWebSearch: false,
    aiLanguage: 'English',
    autocorrection: true,
    fontPreference: 'proportional',
    bodyFont: 'lato',
    monospaceFont: 'iawriter',
    titleFont: 'handlee',
  },
  days: {
    days: [],
    loading: false,
    loadingMore: false,
    hasMorePast: false,
    loadError: null as string | null,
    loadTimeline: vi.fn().mockResolvedValue(undefined),
    loadOlderDays: vi.fn().mockResolvedValue(undefined),
    loadDay: vi.fn().mockResolvedValue(undefined),
    patchDayContent: vi.fn(),
    updateDayContent: vi.fn(),
    moveDayDate: vi.fn(),
    deleteDay: vi.fn(),
  },
  sync: {
    loadState: vi.fn().mockResolvedValue(undefined),
    status: { connected: false, targetName: null },
  },
}))

vi.mock('../store/useSettingsStore', () => ({
  useSettingsStore: (selector: (state: typeof stores.settings) => unknown) => selector(stores.settings),
}))
vi.mock('../store/useDaysStore', () => ({
  useDaysStore: Object.assign(
    (selector: (state: typeof stores.days) => unknown) => selector(stores.days),
    { getState: () => stores.days },
  ),
}))
vi.mock('../store/useSyncStore', () => ({
  useSyncStore: (selector: (state: typeof stores.sync) => unknown) => selector(stores.sync),
}))
vi.mock('../hooks/useIsNarrowViewport', () => ({ useIsNarrowViewport: () => true }))
vi.mock('../lib/dayRepository', () => ({
  appendToDay: vi.fn().mockResolvedValue(undefined),
  searchDays: vi.fn().mockResolvedValue([]),
}))
vi.mock('../components/timeline/DayEditorCard', () => ({
  default: () => <div data-testid="day-editor-card" />,
}))
vi.mock('./timeline/useCitationNavigation', () => ({
  useCitationNavigation: () => ({
    handleCitationClick: vi.fn(),
    handleAssistantMarkdownClick: vi.fn(),
    handleAssistantMarkdownKeyDown: vi.fn(),
  }),
}))
vi.mock('../components/timeline/EmptyStateHero', () => ({
  default: () => <div data-testid="empty-state-hero">Empty Hero</div>,
}))

const ensureTrayContainers = () => {
  for (const id of ['bottom-tray', 'bottom-tray-pills']) {
    document.getElementById(id)?.remove()
    const container = document.createElement('div')
    container.id = id
    document.body.appendChild(container)
  }
}

describe('Timeline mobile chat UX', () => {
  beforeEach(() => {
    installMatchMedia(true)
    ensureTrayContainers()
    stores.settings.providerSettings = DEFAULT_LLM_PROVIDER_SETTINGS
    stores.days.days = []
    stores.days.loading = false
    useChatStore.setState({ messages: [] })
    useUIStore.setState({
      mode: 'chat',
      chatPanelOpen: true,
      chatMessageCount: 0,
      desktopPanelExpanded: false,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('puts Back to timeline inside the composer, which closes the overlay and blurs the field', () => {
    useUIStore.setState({ chatPanelOpen: true, chatMessageCount: 2 })
    render(
      <MemoryRouter>
        <Timeline />
      </MemoryRouter>,
    )

    const composer = screen.getByPlaceholderText('Ask Rivolo')
    const form = composer.closest('form')!
    const backButton = within(form).getByRole('button', { name: 'Back to timeline' })
    expect(document.getElementById('bottom-tray-pills')).toBeEmptyDOMElement()

    composer.focus()
    fireEvent.change(composer, { target: { value: 'keep this draft' } })
    fireEvent.click(backButton)

    expect(useUIStore.getState().chatPanelOpen).toBe(false)
    expect(document.activeElement).not.toBe(composer)
    expect(composer).toHaveValue('keep this draft')
  })

  it('puts Open chat in the same composer slot when a conversation exists', () => {
    useUIStore.setState({ chatPanelOpen: false, chatMessageCount: 2 })
    useChatStore.setState({
      messages: [
        { id: '1', role: 'user', content: 'hello', createdAt: 1 },
        { id: '2', role: 'assistant', content: 'hi', createdAt: 2 },
      ],
    })

    render(
      <MemoryRouter>
        <Timeline />
      </MemoryRouter>,
    )

    // Overlay is not up; empty state / timeline is visible
    expect(screen.getByTestId('empty-state-hero')).toBeInTheDocument()

    const form = screen.getByPlaceholderText('Ask Rivolo').closest('form')!
    const openChatBtn = within(form).getByRole('button', { name: 'Open chat' })
    expect(document.getElementById('bottom-tray-pills')).toBeEmptyDOMElement()

    fireEvent.click(openChatBtn)
    expect(useUIStore.getState().chatPanelOpen).toBe(true)
  })

  it('leaves the leading slot empty when there is no conversation', () => {
    useUIStore.setState({ chatPanelOpen: false, chatMessageCount: 0 })

    render(
      <MemoryRouter>
        <Timeline />
      </MemoryRouter>,
    )

    expect(screen.queryByRole('button', { name: 'Back to timeline' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open chat' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
  })

  it('opens the composer into a box on focus, before the text wraps', () => {
    render(
      <MemoryRouter>
        <Timeline />
      </MemoryRouter>,
    )

    const composer = screen.getByPlaceholderText('Ask Rivolo')
    const form = composer.closest('form')!
    expect(form).toHaveAttribute('data-expanded', 'false')

    fireEvent.focus(composer)
    expect(form).toHaveAttribute('data-expanded', 'true')
    expect(composer).toHaveAttribute('data-multiline', 'false')

    // Moving focus to a control inside the composer keeps the box.
    fireEvent.blur(composer, { relatedTarget: screen.getByRole('button', { name: 'Send' }) })
    expect(form).toHaveAttribute('data-expanded', 'true')

    fireEvent.blur(composer, { relatedTarget: null })
    expect(form).toHaveAttribute('data-expanded', 'false')
  })

  // No provider key is configured here, so a send attempt surfaces the
  // missing-key error. That error is how these tests see a send happen.
  const chatErrorBubble = () => document.querySelector('.tray-input-error')

  it('lets Return insert a newline on the phone composer instead of sending', async () => {
    render(
      <MemoryRouter>
        <Timeline />
      </MemoryRouter>,
    )

    const composer = screen.getByPlaceholderText('Ask Rivolo')
    expect(composer).toHaveAttribute('enterkeyhint', 'enter')
    fireEvent.focus(composer)
    fireEvent.change(composer, { target: { value: 'first line' } })

    // Not prevented: the browser inserts the newline.
    expect(fireEvent.keyDown(composer, { key: 'Enter' })).toBe(true)
    await act(async () => {})

    expect(composer).toHaveValue('first line')
    expect(chatErrorBubble()).toHaveAttribute('aria-hidden', 'true')
  })

  it('sends with the Send button inside the composer', async () => {
    render(
      <MemoryRouter>
        <Timeline />
      </MemoryRouter>,
    )

    const composer = screen.getByPlaceholderText('Ask Rivolo')
    const form = composer.closest('form')!
    fireEvent.change(composer, { target: { value: 'What did I do today?' } })
    expect(chatErrorBubble()).toHaveAttribute('aria-hidden', 'true')

    await act(async () => {
      fireEvent.click(within(form).getByRole('button', { name: 'Send' }))
    })

    expect(chatErrorBubble()).toHaveAttribute('aria-hidden', 'false')
  })

  it('tapping the composer on mobile restores the chat overlay when messages exist', () => {
    useUIStore.setState({ chatPanelOpen: false, chatMessageCount: 1 })
    useChatStore.setState({
      messages: [{ id: '1', role: 'user', content: 'test', createdAt: 1 }],
    })

    render(
      <MemoryRouter>
        <Timeline />
      </MemoryRouter>,
    )

    const composer = screen.getByPlaceholderText('Ask Rivolo')
    fireEvent.focus(composer)
    expect(useUIStore.getState().chatPanelOpen).toBe(true)
  })

  it('renders the Rivolo logo at top of the mobile chat scroller', () => {
    useUIStore.setState({ chatPanelOpen: true })
    useChatStore.setState({
      messages: [
        { id: '1', role: 'user', content: 'test', createdAt: 1 },
        { id: '2', role: 'assistant', content: 'answer', createdAt: 2 },
      ],
    })

    const { container } = render(
      <MemoryRouter>
        <Timeline />
      </MemoryRouter>,
    )

    const logo = container.querySelector('img[src="/logo.svg"]')
    expect(logo).toBeInTheDocument()
    expect(logo?.parentElement).toHaveClass('mb-auto')
  })

  it('renders custom visual placeholder with sparkle icon for Ask Rivolo that disappears when writing', () => {
    useUIStore.setState({ mode: 'chat' })
    render(
      <MemoryRouter>
        <Timeline />
      </MemoryRouter>,
    )

    const composer = screen.getByPlaceholderText('Ask Rivolo')
    expect(composer).toBeInTheDocument()

    // Overlay is present when empty
    const overlayText = screen.getByText('Ask Rivolo')
    expect(overlayText).toBeInTheDocument()
    const sparkleSvg = overlayText.parentElement?.querySelector('svg')
    expect(sparkleSvg).toBeInTheDocument()

    // Typing hides overlay
    fireEvent.change(composer, { target: { value: 'What did I do today?' } })
    expect(screen.queryByText('Ask Rivolo')).toBeNull()

    // Clearing restores overlay
    fireEvent.change(composer, { target: { value: '' } })
    expect(screen.getByText('Ask Rivolo')).toBeInTheDocument()
  })

  it('renders custom visual placeholder with lens icon for Search all days that disappears when writing', () => {
    useUIStore.setState({ mode: 'search' })
    render(
      <MemoryRouter>
        <Timeline />
      </MemoryRouter>,
    )

    const searchInput = screen.getByPlaceholderText('Search all days')
    expect(searchInput).toBeInTheDocument()

    // Overlay is present when empty
    const overlayText = screen.getByText('Search all days')
    expect(overlayText).toBeInTheDocument()
    const lensSvg = overlayText.parentElement?.querySelector('svg')
    expect(lensSvg).toBeInTheDocument()

    // Typing hides overlay
    fireEvent.change(searchInput, { target: { value: 'meeting' } })
    expect(screen.queryByText('Search all days')).toBeNull()

    // Clearing restores overlay
    fireEvent.change(searchInput, { target: { value: '' } })
    expect(screen.getByText('Search all days')).toBeInTheDocument()
  })

  it('focusing or click on composer with 0 messages does not open chat overlay', () => {
    useUIStore.setState({ chatPanelOpen: false, chatMessageCount: 0 })
    useChatStore.setState({ messages: [] })

    render(
      <MemoryRouter>
        <Timeline />
      </MemoryRouter>,
    )

    const composer = screen.getByPlaceholderText('Ask Rivolo')
    fireEvent.click(composer)
    fireEvent.focus(composer)
    expect(useUIStore.getState().chatPanelOpen).toBe(false)
  })

  it('does not render Back or Open chat in search mode', () => {
    useUIStore.setState({ mode: 'search', chatPanelOpen: false, chatMessageCount: 2 })

    render(
      <MemoryRouter>
        <Timeline />
      </MemoryRouter>,
    )

    expect(screen.queryByRole('button', { name: 'Back to timeline' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open chat' })).toBeNull()
  })

  it('tapping Back to timeline blurs the composer so subsequent click or focus reopens chat', () => {
    useUIStore.setState({ chatPanelOpen: true, chatMessageCount: 2 })
    useChatStore.setState({
      messages: [
        { id: '1', role: 'user', content: 'hello', createdAt: 1 },
        { id: '2', role: 'assistant', content: 'hi', createdAt: 2 },
      ],
    })

    render(
      <MemoryRouter>
        <Timeline />
      </MemoryRouter>,
    )

    const composer = screen.getByPlaceholderText('Ask Rivolo')
    composer.focus()
    expect(document.activeElement).toBe(composer)

    const backButton = screen.getByRole('button', { name: 'Back to timeline' })
    fireEvent.click(backButton)
    expect(useUIStore.getState().chatPanelOpen).toBe(false)
    expect(document.activeElement).not.toBe(composer)

    // Pointer down on composer reopens chat
    fireEvent.click(composer)
    expect(useUIStore.getState().chatPanelOpen).toBe(true)
  })
})
