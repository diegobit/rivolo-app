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

const getComposer = () => screen.getByPlaceholderText<HTMLTextAreaElement>('Ask anything')

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
    useUIStore.setState({ mode: 'chat', desktopChatPanelOpen: true, chatPanelOpen: false, chatMessageCount: 0 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the card with the empty state and composer when there are no messages', () => {
    renderTimeline()

    expect(screen.getByRole('heading', { name: 'Chat' })).toBeInTheDocument()
    expect(screen.getByText('What can I help with?')).toBeInTheDocument()
    expect(getComposer()).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New chat' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close chat' })).toBeInTheDocument()
  })

  it('keeps the card open and focuses the composer after New chat', async () => {
    useChatStore.setState({
      messages: [{ id: 'm1', role: 'user', content: 'hello there' }],
    })
    renderTimeline()

    expect(screen.getByText('hello there')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'New chat' }))

    expect(screen.queryByText('hello there')).not.toBeInTheDocument()
    expect(screen.getByText('What can I help with?')).toBeInTheDocument()
    await waitFor(() => {
      expect(document.activeElement).toBe(getComposer())
    })
  })

  it('blurs the composer and hides the card when it is closed', () => {
    renderTimeline()
    getComposer().focus()

    fireEvent.click(screen.getByRole('button', { name: 'Close chat' }))

    expect(document.activeElement).not.toBe(getComposer())
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
    useUIStore.setState({ mode: 'timeline', desktopChatPanelOpen: true })
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
    useUIStore.setState({ mode: 'timeline', desktopChatPanelOpen: true, chatPanelOpen: false, chatMessageCount: 0 })
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

    expect(screen.queryByPlaceholderText('Search all days')).not.toBeInTheDocument()

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

  it('opening a result keeps the card open and the timeline unfiltered', async () => {
    vi.mocked(searchDays).mockResolvedValue([
      { day: todayDay, matchedBlocks: ['hello world'], blockKind: 'line' },
    ])
    renderTimeline()
    openSearchCard()

    typeQuery('hello')
    await waitForResults(1)

    fireEvent.click(screen.getByRole('button', { name: /Open note for/ }))

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

    fireEvent.click(cardSection!)

    expect(useUIStore.getState().mode).toBe('search')
    expect(screen.getByRole('heading', { name: 'Search' })).toBeInTheDocument()
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

  it('keeps the search draft when the card closes and reopens', () => {
    renderTimeline()
    openSearchCard()

    typeQuery('hello')
    expect(getSearchInput()).toHaveValue('hello')

    fireEvent.click(screen.getByRole('button', { name: 'Close search' }))
    expect(useUIStore.getState().mode).toBe('timeline')
    expect(screen.queryByPlaceholderText('Search all days')).not.toBeInTheDocument()

    openSearchCard()
    expect(getSearchInput()).toHaveValue('hello')
  })
})
