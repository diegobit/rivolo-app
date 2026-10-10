import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Timeline from './Timeline'
import { getTodayId } from '../lib/dates'
import { searchDays } from '../lib/dayRepository'
import type { Day } from '../lib/dayRepository'
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

// useUIStore reads matchMedia while the module graph loads, before beforeEach runs.
vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
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
vi.mock('../hooks/useIsNarrowViewport', () => ({ useIsNarrowViewport: () => false }))
vi.mock('../lib/dayRepository', () => ({
  appendToDay: vi.fn().mockResolvedValue(undefined),
  searchDays: vi.fn().mockResolvedValue([]),
}))
vi.mock('../components/timeline/DayEditorCard', () => ({
  default: () => <div data-testid="day-editor-card" />,
}))
// Captures the navigation the search card triggers: without this, a no-op
// handleOpenMatchedLineResult would satisfy every "card stays open" assertion.
const handleCitationClick = vi.fn().mockResolvedValue(undefined)
vi.mock('./timeline/useCitationNavigation', () => ({
  useCitationNavigation: () => ({
    handleCitationClick,
    handleAssistantMarkdownClick: vi.fn(),
    handleAssistantMarkdownKeyDown: vi.fn(),
  }),
}))
vi.mock('../components/timeline/EmptyStateHero', () => ({
  default: () => <div data-testid="empty-state-hero" />,
}))

const renderTimeline = () =>
  render(
    <MemoryRouter>
      <Timeline />
    </MemoryRouter>,
  )

const setDesktopChatMode = (mode: 'chat' | 'search') =>
  act(() => {
    useUIStore.setState({ mode })
  })

const getComposer = () => screen.getByPlaceholderText<HTMLTextAreaElement>('Ask Rivolo')

const ensureTrayContainers = () => {
  for (const id of ['bottom-tray', 'bottom-tray-pills']) {
    document.getElementById(id)?.remove()
    const container = document.createElement('div')
    container.id = id
    document.body.appendChild(container)
  }
}

describe('Timeline desktop chat card', () => {
  beforeEach(() => {
    installMatchMedia(false)
    ensureTrayContainers()
    stores.settings.providerSettings = DEFAULT_LLM_PROVIDER_SETTINGS
    stores.days.days = []
    stores.days.loading = false
    useChatStore.setState({ messages: [] })
    useUIStore.setState({ mode: 'chat', chatPanelOpen: false, chatMessageCount: 0, desktopPanelExpanded: false })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the card with the empty state and composer when there are no messages', () => {
    renderTimeline()

    expect(screen.getByRole('heading', { name: 'Chat' })).toBeInTheDocument()
    expect(screen.getByText('What can I help with?')).toBeInTheDocument()
    expect(getComposer()).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear chat' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close chat' })).toBeInTheDocument()
  })

  it('expands and restores the panel without losing the draft', () => {
    renderTimeline()
    fireEvent.change(getComposer(), { target: { value: 'A draft to keep' } })
    fireEvent.click(screen.getByRole('button', { name: 'Expand panel' }))
    expect(useUIStore.getState().desktopPanelExpanded).toBe(true)
    expect(getComposer()).toHaveValue('A draft to keep')
    fireEvent.click(screen.getByRole('button', { name: 'Reduce panel width' }))
    expect(useUIStore.getState().desktopPanelExpanded).toBe(false)
    expect(getComposer()).toHaveValue('A draft to keep')
  })

  it('keeps the card open and focuses the composer after Clear chat', async () => {
    useChatStore.setState({
      messages: [{ id: 'm1', role: 'user', content: 'hello there' }],
    })
    renderTimeline()

    expect(screen.getByText('hello there')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Clear chat' }))

    expect(screen.queryByText('hello there')).not.toBeInTheDocument()
    expect(screen.getByText('What can I help with?')).toBeInTheDocument()
    await waitFor(() => {
      expect(document.activeElement).toBe(getComposer())
    })
  })

  it('returns focus to the Chat launcher and hides the card when it is closed', () => {
    // AppShell renders the real launchers; stand one in for it here.
    const launcher = document.createElement('button')
    launcher.dataset.launcher = 'chat'
    document.body.appendChild(launcher)
    renderTimeline()
    getComposer().focus()

    fireEvent.click(screen.getByRole('button', { name: 'Close chat' }))

    expect(document.activeElement).toBe(launcher)
    launcher.remove()
    expect(useUIStore.getState().mode).toBe('timeline')
    expect(document.querySelector('.timeline-chat-sidebar')).toHaveClass('is-chat-closed')
    expect(document.querySelector('.timeline-chat-sidebar')).toHaveAttribute('inert')
  })

  it('hides the card in search mode and restores the conversation when returning to chat', () => {
    useChatStore.setState({
      messages: [{ id: 'm1', role: 'assistant', content: 'kept answer' }],
    })
    renderTimeline()

    setDesktopChatMode('search')
    expect(document.querySelector('.timeline-chat-sidebar')).toHaveClass('is-chat-closed')
    expect(document.querySelector('.timeline-chat-sidebar')).toHaveAttribute('inert')

    setDesktopChatMode('chat')
    expect(screen.getByRole('heading', { name: 'Chat' })).toBeInTheDocument()
    expect(screen.getByText('kept answer')).toBeInTheDocument()
  })

  it('does not remount the timeline when toggling between timeline, chat, and search modes', () => {
    stores.days.days = [
      {
        dayId: getTodayId(),
        humanTitle: '',
        contentMd: 'today note',
        createdAt: 0,
        updatedAt: 0,
      },
    ]
    useUIStore.setState({ mode: 'timeline' })
    renderTimeline()

    const initialEditorElement = screen.getByTestId('day-editor-card')
    expect(initialEditorElement).toBeInTheDocument()

    // Toggle to chat mode
    setDesktopChatMode('chat')
    const chatEditorElement = screen.getByTestId('day-editor-card')
    expect(chatEditorElement).toBe(initialEditorElement)

    // Toggle back to timeline mode
    act(() => {
      useUIStore.setState({ mode: 'timeline' })
    })
    const timelineEditorElement = screen.getByTestId('day-editor-card')
    expect(timelineEditorElement).toBe(initialEditorElement)

    // Toggle to search mode
    setDesktopChatMode('search')
    const searchEditorElement = screen.getByTestId('day-editor-card')
    expect(searchEditorElement).toBe(initialEditorElement)
  })

  it('keeps chat and search drafts separate across mode switches', () => {
    renderTimeline()

    fireEvent.change(getComposer(), { target: { value: 'draft for the assistant' } })
    expect(getComposer()).toHaveValue('draft for the assistant')

    setDesktopChatMode('search')
    const searchInput = screen.getByPlaceholderText<HTMLTextAreaElement>('Search all days')
    expect(searchInput).toHaveValue('')

    fireEvent.change(searchInput, { target: { value: 'draft for search' } })

    setDesktopChatMode('chat')
    expect(getComposer()).toHaveValue('draft for the assistant')

    setDesktopChatMode('search')
    expect(screen.getByPlaceholderText('Search all days')).toHaveValue('draft for search')
  })
})

describe('Timeline desktop search card', () => {
  const todayId = getTodayId()
  const makeDay = (dayId: string, contentMd: string): Day => ({
    dayId,
    humanTitle: '',
    contentMd,
    createdAt: 0,
    updatedAt: 0,
  })
  const todayDay = makeDay(todayId, 'hello world\nhello again\nplain line')
  const olderDay = makeDay('2020-01-01', 'unrelated note')

  beforeEach(() => {
    installMatchMedia(false)
    ensureTrayContainers()
    stores.settings.providerSettings = DEFAULT_LLM_PROVIDER_SETTINGS
    stores.days.days = [todayDay, olderDay]
    stores.days.loading = false
    useChatStore.setState({ messages: [] })
    useUIStore.setState({ mode: 'timeline', chatPanelOpen: false, chatMessageCount: 0, desktopPanelExpanded: false })
    vi.mocked(searchDays).mockReset().mockResolvedValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const openSearchCard = () =>
    act(() => {
      useUIStore.setState({ mode: 'search' })
    })

  const getSearchInput = () => screen.getByPlaceholderText<HTMLTextAreaElement>('Search all days')

  const typeQuery = (value: string) => {
    fireEvent.change(getSearchInput(), { target: { value } })
  }

  const getResultOpenButtons = () => screen.queryAllByRole('button', { name: /Open note for/ })

  const waitForResults = async (expectedCount: number) => {
    await waitFor(() => {
      expect(getResultOpenButtons()).toHaveLength(expectedCount)
    })
  }

  it('opens the left search card with the search field and pills, without the chat card', () => {
    renderTimeline()

    expect(getSearchInput().closest('aside')).toHaveAttribute('inert')
    expect(screen.queryByRole('heading', { name: 'Search' })).not.toBeInTheDocument()

    openSearchCard()

    expect(screen.getByRole('heading', { name: 'Search' })).toBeInTheDocument()
    expect(getSearchInput()).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close search' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'TODOs' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Chat' })).not.toBeInTheDocument()
  })

  it('shows search results in the card while keeping the timeline unfiltered', async () => {
    vi.mocked(searchDays).mockResolvedValue([
      { day: todayDay, matchedBlocks: ['hello world', 'hello again'], blockKind: 'line' },
    ])
    renderTimeline()
    openSearchCard()

    typeQuery('hello')
    await waitForResults(2)
    expect(searchDays).toHaveBeenCalledWith('hello', { filter: null })

    // The timeline keeps showing every day instead of filtering to results.
    expect(screen.getAllByTestId('day-editor-card')).toHaveLength(2)
  })

  it('retains results, scroll position and a single composer through closing and reopening', async () => {
    vi.mocked(searchDays).mockResolvedValue([
      { day: todayDay, matchedBlocks: ['hello world'], blockKind: 'line' },
    ])
    renderTimeline()
    openSearchCard()
    typeQuery('hello')
    await waitForResults(1)
    const card = document.querySelector('#desktop-search-card')!
    const result = card.querySelector('.result-open-button')
    const results = card.querySelector('.timeline-search-sidebar-results')!
    results.scrollTop = 80
    fireEvent.click(screen.getByRole('button', { name: 'Close search' }))
    expect(card).toHaveAttribute('inert')
    expect(card).toHaveAttribute('aria-hidden', 'true')
    expect(card.querySelector('.result-open-button')).toBe(result)
    expect(results.scrollTop).toBe(80)
    expect(document.querySelectorAll('#search-input')).toHaveLength(1)
    openSearchCard()
    expect(card).not.toHaveAttribute('inert')
    expect(card.querySelector('.result-open-button')).toBe(result)
    expect(results.scrollTop).toBe(80)
  })

  it('opening a result keeps the card open and the timeline unfiltered', async () => {
    vi.mocked(searchDays).mockResolvedValue([
      { day: todayDay, matchedBlocks: ['hello world'], blockKind: 'line' },
    ])
    renderTimeline()
    openSearchCard()

    typeQuery('hello')
    await waitForResults(1)

    handleCitationClick.mockClear()
    fireEvent.click(screen.getByRole('button', { name: /Open note for/ }))

    await waitFor(() => {
      expect(handleCitationClick).toHaveBeenCalledWith({ day: todayId, quote: 'hello world', lineIndex: 0 })
    })
    expect(useUIStore.getState().mode).toBe('search')
    expect(screen.getByRole('heading', { name: 'Search' })).toBeInTheDocument()
    expect(getSearchInput()).toBeInTheDocument()
    expect(screen.getAllByTestId('day-editor-card')).toHaveLength(2)
  })

  it('clicking the result card body keeps the card open; the row is not a keyboard tab stop', async () => {
    vi.mocked(searchDays).mockResolvedValue([
      { day: todayDay, matchedBlocks: ['hello world'], blockKind: 'line' },
    ])
    renderTimeline()
    openSearchCard()

    typeQuery('hello')
    await waitForResults(1)

    const cardSection = screen.getByRole('button', { name: /Open note for/ }).closest('section')
    expect(cardSection).toBeInTheDocument()
    expect(cardSection).not.toHaveAttribute('tabindex')

    handleCitationClick.mockClear()
    fireEvent.click(cardSection!)

    await waitFor(() => {
      expect(handleCitationClick).toHaveBeenCalledWith({ day: todayId, quote: 'hello world', lineIndex: 0 })
    })
    expect(useUIStore.getState().mode).toBe('search')
    expect(screen.getByRole('heading', { name: 'Search' })).toBeInTheDocument()
  })

  it('does not open a note when the click ends a text selection in the result', async () => {
    vi.mocked(searchDays).mockResolvedValue([
      { day: todayDay, matchedBlocks: ['hello world'], blockKind: 'line' },
    ])
    renderTimeline()
    openSearchCard()
    typeQuery('hello')
    await waitForResults(1)
    const cardSection = screen.getByRole('button', { name: /Open note for/ }).closest('section')!
    const selection = vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => 'hello' } as Selection)
    handleCitationClick.mockClear()

    fireEvent.click(cardSection)
    await new Promise((resolve) => requestAnimationFrame(resolve))

    expect(handleCitationClick).not.toHaveBeenCalled()
    selection.mockRestore()
  })

  it('describes each Open button with its own match, so same-day matches differ', async () => {
    vi.mocked(searchDays).mockResolvedValue([
      { day: todayDay, matchedBlocks: ['hello world', 'hello again'], blockKind: 'line' },
    ])
    renderTimeline()
    openSearchCard()
    typeQuery('hello')
    await waitForResults(2)

    const [first, second] = getResultOpenButtons()
    expect(first).toHaveAccessibleDescription(/hello world/)
    expect(second).toHaveAccessibleDescription(/hello again/)
  })

  it('groups matches by day while each match opens its own line', async () => {
    vi.mocked(searchDays).mockResolvedValue([
      { day: todayDay, matchedBlocks: ['hello world', 'hello again'], blockKind: 'line' },
      { day: olderDay, matchedBlocks: ['unrelated note'], blockKind: 'line' },
    ])
    renderTimeline()
    openSearchCard()
    typeQuery('hello')
    await waitForResults(3)

    const groups = document.querySelectorAll('.matched-result-group')
    expect(groups).toHaveLength(2)
    expect(groups[0].querySelectorAll('.result-open-button')).toHaveLength(2)
    expect(groups[0].querySelectorAll('p')[0]).toHaveTextContent('Today')
    expect(groups[0].textContent?.match(/Today/g)).toHaveLength(1)
    fireEvent.click(getResultOpenButtons()[1])
    await waitFor(() => {
      expect(handleCitationClick).toHaveBeenCalledWith(
        { day: todayId, quote: 'hello again', lineIndex: 1 },
      )
    })
  })

  it('announces the match count and No results through one status region', async () => {
    vi.mocked(searchDays).mockResolvedValue([
      { day: todayDay, matchedBlocks: ['hello world', 'hello again'], blockKind: 'line' },
    ])
    renderTimeline()
    openSearchCard()
    typeQuery('hello')
    await waitForResults(2)

    expect(screen.getByRole('status')).toHaveTextContent('2 matches')

    vi.mocked(searchDays).mockResolvedValue([])
    typeQuery('zzz')
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('No results')
    })
  })

  it('moves from the search field into the results with the arrow keys and back', async () => {
    vi.mocked(searchDays).mockResolvedValue([
      { day: todayDay, matchedBlocks: ['hello world', 'hello again'], blockKind: 'line' },
    ])
    renderTimeline()
    openSearchCard()
    typeQuery('hello')
    await waitForResults(2)
    const [first, second] = getResultOpenButtons()
    getSearchInput().focus()

    fireEvent.keyDown(getSearchInput(), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(first)

    fireEvent.keyDown(first, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(second)

    fireEvent.keyDown(second, { key: 'ArrowUp' })
    fireEvent.keyDown(first, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(getSearchInput())
  })

  it('renders a large result set a page at a time', async () => {
    const blocks = Array.from({ length: 120 }, (_, index) => `hello line ${index}`)
    vi.mocked(searchDays).mockResolvedValue([{ day: todayDay, matchedBlocks: blocks, blockKind: 'line' }])
    renderTimeline()
    openSearchCard()
    typeQuery('hello')
    await waitForResults(50)

    expect(screen.getByRole('status')).toHaveTextContent('120 matches')
    fireEvent.click(screen.getByRole('button', { name: 'Show 50 more' }))
    await waitForResults(100)
    fireEvent.click(screen.getByRole('button', { name: 'Show 20 more' }))
    await waitForResults(120)
    expect(screen.queryByRole('button', { name: /more$/ })).not.toBeInTheDocument()
  })

  it('opens the exact occurrence when a day repeats the same matched line', async () => {
    const repeatedDay = makeDay(todayId, 'apple repeated\nfiller\napple repeated')
    vi.mocked(searchDays).mockResolvedValue([
      { day: repeatedDay, matchedBlocks: ['apple repeated', 'apple repeated'], blockKind: 'line' },
    ])
    renderTimeline()
    openSearchCard()
    typeQuery('apple')
    await waitForResults(2)
    handleCitationClick.mockClear()

    fireEvent.click(getResultOpenButtons()[1])

    await waitFor(() => {
      expect(handleCitationClick).toHaveBeenCalledWith({ day: todayId, quote: 'apple repeated', lineIndex: 2 })
    })
  })

  it('keeps ArrowDown going past the first page of results', async () => {
    const blocks = Array.from({ length: 60 }, (_, index) => `hello line ${index}`)
    vi.mocked(searchDays).mockResolvedValue([{ day: todayDay, matchedBlocks: blocks, blockKind: 'line' }])
    renderTimeline()
    openSearchCard()
    typeQuery('hello')
    await waitForResults(50)
    const lastLoaded = getResultOpenButtons()[49]
    lastLoaded.focus()

    fireEvent.keyDown(lastLoaded, { key: 'ArrowDown' })

    await waitForResults(60)
    expect(document.activeElement).toBe(getResultOpenButtons()[50])
  })

  it('opens the exact occurrence of a repeated section heading', async () => {
    const sectionsDay = makeDay(todayId, '# apple heading\nfirst body\nfiller\n# apple heading\nsecond body')
    vi.mocked(searchDays).mockResolvedValue([
      {
        day: sectionsDay,
        matchedBlocks: ['# apple heading\nfirst body\nfiller', '# apple heading\nsecond body'],
        blockKind: 'section',
      },
    ])
    renderTimeline()
    openSearchCard()
    typeQuery('apple')
    await waitForResults(2)
    handleCitationClick.mockClear()

    fireEvent.click(getResultOpenButtons()[1])

    await waitFor(() => {
      expect(handleCitationClick).toHaveBeenCalledWith(
        expect.objectContaining({ day: todayId, lineIndex: 3 }),
      )
    })
  })

  it('toggling a todo in a text-search result does not navigate or close the card', async () => {
    const todoDay = makeDay(todayId, '- [ ] Buy milk and cookies')
    vi.mocked(searchDays).mockResolvedValue([
      { day: todoDay, matchedBlocks: ['- [ ] Buy milk and cookies'], blockKind: 'line' },
    ])
    renderTimeline()
    openSearchCard()

    typeQuery('Buy milk')
    await waitForResults(1)

    const todoButton = screen.getByRole('button', { name: 'Toggle todo' })
    expect(todoButton).toHaveTextContent('[ ]')
    fireEvent.click(todoButton)

    expect(useUIStore.getState().mode).toBe('search')
    expect(screen.getByRole('heading', { name: 'Search' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Toggle todo' })).toHaveTextContent('[x]')
  })

  it('toggling a todo in search results does not navigate or close the card', async () => {
    const todoDay = makeDay(todayId, '- [ ] todo item')
    vi.mocked(searchDays).mockResolvedValue([
      { day: todoDay, matchedBlocks: ['- [ ] todo item'], blockKind: 'line' },
    ])
    renderTimeline()
    openSearchCard()

    fireEvent.click(screen.getByRole('button', { name: 'TODOs' }))
    typeQuery('todo')
    await waitForResults(1)

    const todoButton = screen.getByRole('button', { name: 'Toggle todo' })
    fireEvent.click(todoButton)

    // Mode is still search, card remains open
    expect(useUIStore.getState().mode).toBe('search')
    expect(screen.getByRole('heading', { name: 'Search' })).toBeInTheDocument()
  })

  it('lists every match and offers no Days/Lines toggle', async () => {
    vi.mocked(searchDays).mockResolvedValue([
      { day: todayDay, matchedBlocks: ['hello world', 'hello again'], blockKind: 'line' },
    ])
    renderTimeline()
    openSearchCard()

    typeQuery('hello')
    await waitForResults(2)

    expect(screen.queryByRole('button', { name: /Toggle result mode/ })).not.toBeInTheDocument()
  })

  it('shows No results in the card when nothing matches', async () => {
    renderTimeline()
    openSearchCard()

    typeQuery('zzz')

    await waitFor(() => {
      expect(screen.getByText('No results')).toBeInTheDocument()
    })
    expect(screen.getAllByTestId('day-editor-card')).toHaveLength(2)
  })

  it('returns focus to the Search launcher when the card is closed with its X', () => {
    const launcher = document.createElement('button')
    launcher.dataset.launcher = 'search'
    document.body.appendChild(launcher)
    renderTimeline()
    openSearchCard()
    getSearchInput().focus()

    fireEvent.click(screen.getByRole('button', { name: 'Close search' }))

    expect(document.activeElement).toBe(launcher)
    launcher.remove()
  })

  it('keeps focus in the search field after Clear search', () => {
    renderTimeline()
    openSearchCard()
    typeQuery('hello')

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))

    expect(getSearchInput()).toHaveValue('')
    expect(document.activeElement).toBe(getSearchInput())
  })

  it('keeps the search draft when the card closes and reopens', () => {
    renderTimeline()
    openSearchCard()

    typeQuery('hello')
    expect(getSearchInput()).toHaveValue('hello')

    fireEvent.click(screen.getByRole('button', { name: 'Close search' }))
    expect(useUIStore.getState().mode).toBe('timeline')
    expect(getSearchInput().closest('aside')).toHaveAttribute('inert')
    expect(screen.queryByRole('heading', { name: 'Search' })).not.toBeInTheDocument()

    openSearchCard()
    expect(getSearchInput()).toHaveValue('hello')
  })
})
