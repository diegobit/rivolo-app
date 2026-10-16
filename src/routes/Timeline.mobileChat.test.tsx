import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Timeline from './Timeline'
import { DEFAULT_LLM_PROVIDER_SETTINGS } from '../lib/llm/types'
import { useChatStore } from '../store/useChatStore'
import { useUIStore } from '../store/useUIStore'
import { MOBILE_MENU_OPEN_EVENT } from '../lib/timelineEvents'

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
  for (const id of ['bottom-tray']) {
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
      menuAttentionCount: 0,
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

  it('shows labelled Timeline and Menu chips without focus, and Menu opens the sheet', () => {
    useUIStore.setState({ chatPanelOpen: true, chatMessageCount: 2, menuAttentionCount: 2 })
    const openMenu = vi.fn()
    window.addEventListener(MOBILE_MENU_OPEN_EVENT, openMenu)
    render(
      <MemoryRouter>
        <Timeline />
      </MemoryRouter>,
    )

    const composer = screen.getByPlaceholderText('Ask Rivolo')
    const form = composer.closest('form')!
    expect(form).toHaveClass('tray-phone-composer')
    expect(within(form).getByRole('button', { name: 'Back to timeline' })).toHaveTextContent('Timeline')
    const menuChip = within(form).getByRole('button', { name: 'Menu, 2 items need attention' })
    expect(menuChip).toHaveTextContent('Menu2')
    // Menu first, then Timeline, then Send on its own at the right.
    expect(within(form).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
      'Menu, 2 items need attention',
      'Back to timeline',
      'Send',
    ])

    composer.focus()
    fireEvent.change(composer, { target: { value: 'keep this draft' } })
    fireEvent.click(menuChip)
    expect(openMenu).toHaveBeenCalledTimes(1)
    expect(document.activeElement).not.toBe(composer)
    expect(composer).toHaveValue('keep this draft')
    expect(useUIStore.getState().chatPanelOpen).toBe(true)
    window.removeEventListener(MOBILE_MENU_OPEN_EVENT, openMenu)
  })

  it('labels the first chip Chat on the timeline', () => {
    useUIStore.setState({ chatPanelOpen: false, chatMessageCount: 1 })
    useChatStore.setState({ messages: [{ id: '1', role: 'user', content: 'hello', createdAt: 1 }] })
    render(
      <MemoryRouter>
        <Timeline />
      </MemoryRouter>,
    )

    const form = screen.getByPlaceholderText('Ask Rivolo').closest('form')!
    expect(within(form).getByRole('button', { name: 'Open chat' })).toHaveTextContent(/^Chat$/)
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
    // A short thread still overflows by a pixel, so it can always be scrolled.
    expect(logo?.parentElement?.parentElement).toHaveClass('min-h-[calc(100%+1px)]')
  })

  it('shows Ask Rivolo as a plain placeholder, with no icon for the caret to cover', () => {
    render(
      <MemoryRouter>
        <Timeline />
      </MemoryRouter>,
    )

    const composer = screen.getByPlaceholderText('Ask Rivolo')
    expect(composer.parentElement?.querySelector('svg')).toBeNull()
  })

  it('keeps the search lens in place while the field is focused and filled', () => {
    useUIStore.setState({ mode: 'search' })
    render(
      <MemoryRouter>
        <Timeline />
      </MemoryRouter>,
    )

    const searchInput = screen.getByPlaceholderText('Search all days')
    const lens = () => searchInput.parentElement?.querySelector('svg')
    expect(lens()).toBeInTheDocument()

    searchInput.focus()
    fireEvent.change(searchInput, { target: { value: 'meeting' } })
    expect(lens()).toBeInTheDocument()
    expect(lens()).not.toHaveClass('invisible')
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

  it('puts Menu, Days | Lines and the Filter dropdown inside the search box', () => {
    useUIStore.setState({ mode: 'search' })
    const openMenu = vi.fn()
    window.addEventListener(MOBILE_MENU_OPEN_EVENT, openMenu)
    render(
      <MemoryRouter>
        <Timeline />
      </MemoryRouter>,
    )

    const searchInput = screen.getByPlaceholderText('Search all days')
    const form = searchInput.closest('form')!
    expect(form).toHaveClass('tray-phone-composer')
    expect(form).toHaveAttribute('data-mode', 'search')
    const lines = within(form).getByRole('button', { name: 'Lines' })
    expect(lines).toHaveAttribute('aria-pressed', 'false')
    expect(within(form).getByRole('button', { name: 'Filter' })).toBeInTheDocument()

    fireEvent.click(lines)
    expect(within(form).getByRole('button', { name: 'Lines' })).toHaveAttribute('aria-pressed', 'true')

    searchInput.focus()
    fireEvent.change(searchInput, { target: { value: 'hotel' } })
    expect(within(form).getByRole('button', { name: 'Clear search' })).toBeInTheDocument()

    fireEvent.click(within(form).getByRole('button', { name: 'Menu' }))
    expect(openMenu).toHaveBeenCalledTimes(1)
    expect(document.activeElement).not.toBe(searchInput)
    expect(searchInput).toHaveValue('hotel')
    window.removeEventListener(MOBILE_MENU_OPEN_EVENT, openMenu)
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
