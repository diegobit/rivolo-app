import { fireEvent, render, screen } from '@testing-library/react'
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

  it('renders floating Back to timeline button on mobile when chat overlay is open', () => {
    render(
      <MemoryRouter>
        <Timeline />
      </MemoryRouter>,
    )

    const backButton = screen.getByRole('button', { name: 'Back to timeline' })
    expect(backButton).toBeInTheDocument()

    // Clicking it closes the overlay
    fireEvent.click(backButton)
    expect(useUIStore.getState().chatPanelOpen).toBe(false)
  })

  it('renders floating Open chat button on timeline when collapsed with existing messages', () => {
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

    const openChatBtn = screen.getByRole('button', { name: 'Open chat' })
    expect(openChatBtn).toBeInTheDocument()

    fireEvent.click(openChatBtn)
    expect(useUIStore.getState().chatPanelOpen).toBe(true)
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

    const composer = screen.getByPlaceholderText('Ask anything')
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
})
