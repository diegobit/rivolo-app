import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TIMELINE_NEW_CHAT_EVENT } from '../lib/timelineEvents'
import AppShell from './AppShell'

const stores = vi.hoisted(() => ({
  settings: {
    loadSettings: vi.fn().mockResolvedValue(undefined),
    provider: 'gemini',
    providerSettings: {},
    llmSecrets: {} as Record<string, { apiKey?: string }>,
    dismissedSetupNotices: { ai: false, sync: false },
    dismissSetupNotice: vi.fn().mockResolvedValue(undefined),
    themePreference: 'system' as 'system' | 'light' | 'dark',
    updateThemePreference: vi.fn().mockResolvedValue(undefined),
    wallpaper: 'thoughts-light',
    highlightInputMode: false,
  },
  days: {
    loaded: true,
    loading: false,
    days: [{}],
  },
  sync: {
    loadState: vi.fn().mockResolvedValue(undefined),
    activeProvider: null as string | null,
    status: {
      connected: false,
      targetName: null,
      localDirty: false,
    },
    syncing: false,
    syncOperation: null,
    syncAttention: null as { operation: string; message: string; at: number } | null,
  },
  tabSync: { isPrimary: false, databaseStale: true },
  ui: {
    mode: 'timeline',
    setMode: vi.fn(),
    chatPanelOpen: false,
    setChatPanelOpen: vi.fn(),
    desktopChatPanelOpen: false,
    setDesktopChatPanelOpen: vi.fn(),
    chatMessageCount: 0,
    timelineEmpty: null as boolean | null,
    setTimelineEmpty: vi.fn(),
  },
  viewport: {
    isNarrow: false,
  },
}))

vi.mock('../store/useSettingsStore', () => ({
  useSettingsStore: (selector: (state: typeof stores.settings) => unknown) => selector(stores.settings),
}))
vi.mock('../store/useDaysStore', () => ({
  useDaysStore: (selector: (state: typeof stores.days) => unknown) => selector(stores.days),
}))
vi.mock('../store/useSyncStore', () => ({
  useSyncStore: (selector: (state: typeof stores.sync) => unknown) => selector(stores.sync),
}))
vi.mock('../store/useUIStore', () => ({
  useUIStore: (selector: (state: typeof stores.ui) => unknown) => selector(stores.ui),
}))
vi.mock('../hooks/useIsNarrowViewport', () => ({ useIsNarrowViewport: () => stores.viewport.isNarrow }))
vi.mock('../hooks/useKeyboardOffsetCssVar', () => ({ useKeyboardOffsetCssVar: vi.fn() }))
vi.mock('../hooks/useTabSyncState', () => ({
  useTabSyncState: () => stores.tabSync,
}))
vi.mock('./app-shell/useAutoSync', () => ({ useAutoSync: vi.fn() }))
vi.mock('./app-shell/BottomTrayRow', () => ({
  default: ({
    chatButton,
    searchButton,
    modeToggleButton,
    showScrollToToday,
  }: {
    chatButton: React.ReactNode
    searchButton: React.ReactNode
    modeToggleButton: React.ReactNode
    showScrollToToday: boolean
  }) => (
    <>
      {searchButton}
      {chatButton}
      {modeToggleButton}
      {showScrollToToday ? <div data-testid="scroll-to-today-visible" /> : null}
    </>
  ),
}))
vi.mock('./app-shell/ShortcutsPopover', () => ({
  default: ({ shortcutsRef }: { shortcutsRef: { current: HTMLDivElement | null } }) => (
    <div ref={shortcutsRef}>
      <button type="button" aria-label="Shortcuts">
        ?
      </button>
    </div>
  ),
}))

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

const getHeaderSlots = () => {
  const logo = screen.getByRole('link', { name: 'Home' })
  const left = logo.previousElementSibling
  const right = logo.nextElementSibling

  if (!(left instanceof HTMLElement) || !(right instanceof HTMLElement)) {
    throw new Error('Header slots could not be resolved')
  }

  return { left, right }
}

describe('AppShell attention and stale tab states', () => {
  beforeEach(() => {
    installMatchMedia(false)
    document.head.innerHTML = '<meta name="theme-color" content="#ffffff" />'
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('data-theme-preference')
    stores.tabSync = { isPrimary: false, databaseStale: true }
    stores.settings.llmSecrets = {}
    stores.settings.dismissedSetupNotices = { ai: false, sync: false }
    stores.settings.dismissSetupNotice.mockClear()
    stores.settings.themePreference = 'system'
    stores.settings.updateThemePreference.mockClear()
    stores.days = { loaded: true, loading: false, days: [{}] }
    stores.sync.activeProvider = null
    stores.sync.syncAttention = null
    stores.ui.mode = 'timeline'
    stores.ui.chatPanelOpen = false
    stores.ui.desktopChatPanelOpen = false
    stores.ui.chatMessageCount = 0
    stores.ui.timelineEmpty = null
    stores.viewport.isNarrow = false
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('briefly speeds up the logo current on logo click', () => {
    vi.useFakeTimers()
    stores.tabSync = { isPrimary: true, databaseStale: false }
    const scrollTo = vi.fn()
    vi.stubGlobal('scrollTo', scrollTo)

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<AppShell />} />
        </Routes>
      </MemoryRouter>,
    )

    const homeLink = screen.getByRole('link', { name: 'Home' })
    expect(homeLink).not.toHaveClass('logo-current-fast')

    fireEvent.click(homeLink)

    expect(homeLink).toHaveClass('logo-current-fast')
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 0, behavior: 'smooth' })

    act(() => vi.advanceTimersByTime(899))
    expect(homeLink).toHaveClass('logo-current-fast')

    act(() => vi.advanceTimersByTime(1))
    expect(homeLink).not.toHaveClass('logo-current-fast')
  })

  it('makes the main surface inert and keeps reload available', () => {
    stores.tabSync = { isPrimary: false, databaseStale: true }
    stores.sync.syncAttention = null
    const { container } = render(
      <MemoryRouter initialEntries={['/settings']}>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route path="settings" element={<button type="button">Unsafe action</button>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    expect(container.querySelector('main')).toHaveAttribute('inert')
    expect(screen.getByRole('button', { name: 'Reload stale tab' })).toBeVisible()
  })

  it('puts a sync issue in the unified attention popover', async () => {
    stores.tabSync = { isPrimary: true, databaseStale: false }
    stores.settings.llmSecrets = { gemini: { apiKey: 'test-key' } }
    stores.sync.activeProvider = 'google-drive'
    stores.sync.syncAttention = {
      operation: 'push',
      message: 'Google Drive changed remotely.',
      at: 0,
    }
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<AppShell />} />
        </Routes>
      </MemoryRouter>,
    )

    const indicator = screen.getByRole('button', { name: '1 item needs attention' })
    expect(indicator).toBeVisible()
    await userEvent.click(indicator)
    expect(screen.getByRole('dialog', { name: 'Items needing attention' })).toBeVisible()
    expect(screen.getByRole('link', { name: /Sync needs attention/ })).toHaveAttribute(
      'href',
      '/settings#settings-sync',
    )
  })

  it('shows and individually dismisses both new-user setup notices on Timeline', async () => {
    stores.tabSync = { isPrimary: true, databaseStale: false }

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<AppShell />} />
        </Routes>
      </MemoryRouter>,
    )

    const indicator = await screen.findByRole('button', { name: '2 items need attention' })
    await userEvent.click(indicator)

    expect(screen.getByRole('link', { name: /AI assistant isn't set up/ })).toHaveAttribute(
      'href',
      '/settings#settings-ai',
    )
    expect(screen.getByRole('link', { name: /Cloud sync is off/ })).toHaveAttribute(
      'href',
      '/settings#settings-sync',
    )

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Items needing attention' })).not.toBeInTheDocument()
    expect(indicator).toHaveFocus()

    await userEvent.click(indicator)
    await userEvent.click(screen.getByRole('button', { name: "Dismiss AI assistant isn't set up" }))
    expect(stores.settings.dismissSetupNotice).toHaveBeenCalledExactlyOnceWith('ai')
  })

  it('does not show setup attention on the Settings page', async () => {
    stores.tabSync = { isPrimary: true, databaseStale: false }

    render(
      <MemoryRouter initialEntries={['/settings']}>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route path="settings" element={<div>Settings content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Settings content')).toBeVisible()
    expect(screen.queryByRole('button', { name: '2 items need attention' })).not.toBeInTheDocument()
  })

  it('applies the resolved system theme and runtime theme color', async () => {
    installMatchMedia(true)
    stores.tabSync = { isPrimary: true, databaseStale: false }
    stores.settings.themePreference = 'system'

    render(
      <MemoryRouter initialEntries={['/settings']}>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route path="settings" element={<div>Settings content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    await act(async () => undefined)
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(document.documentElement).toHaveAttribute('data-theme-preference', 'system')
    expect(document.querySelector("meta[name='theme-color']")).toHaveAttribute('content', '#05070b')
  })

  it('shows the current theme state and cycles the header theme button', async () => {
    stores.tabSync = { isPrimary: true, databaseStale: false }
    const renderSettingsShell = () => (
      <MemoryRouter initialEntries={['/privacy']}>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route path="privacy" element={<div>Privacy content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    )
    const { rerender } = render(renderSettingsShell())

    const systemThemeButton = screen.getByRole('button', { name: 'Theme: System' })
    expect(systemThemeButton.querySelector('img')).toHaveAttribute('src', '/sun-horizon.svg')

    await userEvent.click(systemThemeButton)
    expect(stores.settings.updateThemePreference).toHaveBeenCalledExactlyOnceWith('light')

    stores.settings.updateThemePreference.mockClear()
    stores.settings.themePreference = 'light'
    rerender(renderSettingsShell())
    await userEvent.click(screen.getByRole('button', { name: 'Theme: Light' }))
    expect(stores.settings.updateThemePreference).toHaveBeenCalledExactlyOnceWith('dark')

    stores.settings.updateThemePreference.mockClear()
    stores.settings.themePreference = 'dark'
    rerender(renderSettingsShell())
    await userEvent.click(screen.getByRole('button', { name: 'Theme: Dark' }))
    expect(stores.settings.updateThemePreference).toHaveBeenCalledExactlyOnceWith('system')
  })

  it('uses mobile home header slots with settings on the right and no theme shortcut', () => {
    stores.tabSync = { isPrimary: true, databaseStale: false }
    stores.settings.llmSecrets = { gemini: { apiKey: 'test-key' } }
    stores.sync.activeProvider = 'google-drive'
    stores.viewport.isNarrow = true

    const renderShell = (initialEntry: string) => (
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route index element={<div>Timeline content</div>} />
            <Route path="settings" element={<div>Settings content</div>} />
            <Route path="privacy" element={<div>Privacy content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    )
    render(renderShell('/'))

    const settingsLink = screen.getByRole('link', { name: 'Settings' })
    const { left, right } = getHeaderSlots()

    expect(screen.queryByRole('button', { name: 'Theme: System' })).not.toBeInTheDocument()
    expect(left).toBeEmptyDOMElement()
    expect(right).toContainElement(settingsLink)
    expect(screen.queryByRole('button', { name: 'Shortcuts' })).not.toBeInTheDocument()
  })

  it('shows mobile new chat in the left header slot during chat', async () => {
    stores.tabSync = { isPrimary: true, databaseStale: false }
    stores.viewport.isNarrow = true
    stores.ui.mode = 'chat'
    stores.ui.chatMessageCount = 1
    const onNewChat = vi.fn()
    window.addEventListener(TIMELINE_NEW_CHAT_EVENT, onNewChat)

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route index element={<div>Timeline content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    const newChatButton = screen.getByRole('button', { name: 'New chat' })
    const { left } = getHeaderSlots()

    expect(left).toContainElement(newChatButton)

    await userEvent.click(newChatButton)
    expect(onNewChat).toHaveBeenCalledOnce()

    window.removeEventListener(TIMELINE_NEW_CHAT_EVENT, onNewChat)
  })

  it('uses mobile route header slots with back on the left and no theme shortcut', () => {
    stores.tabSync = { isPrimary: true, databaseStale: false }
    stores.viewport.isNarrow = true

    render(
      <MemoryRouter initialEntries={['/settings']}>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route path="settings" element={<div>Settings content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    const backLink = screen.getByRole('link', { name: 'Back' })
    const { left, right } = getHeaderSlots()

    expect(left).toContainElement(backLink)
    expect(screen.queryByRole('button', { name: 'Theme: System' })).not.toBeInTheDocument()
    expect(right).toBeEmptyDOMElement()
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Shortcuts' })).not.toBeInTheDocument()
  })

  it('keeps desktop home shortcuts, theme, and settings available', () => {
    stores.tabSync = { isPrimary: true, databaseStale: false }
    stores.viewport.isNarrow = false

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route index element={<div>Timeline content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    const shortcutsButton = screen.getByRole('button', { name: 'Shortcuts' })
    const themeButton = screen.getByRole('button', { name: 'Theme: System' })
    const settingsLink = screen.getByRole('link', { name: 'Settings' })
    const { left, right } = getHeaderSlots()

    expect(left).toContainElement(shortcutsButton)
    expect(right).toContainElement(themeButton)
    expect(right).toContainElement(settingsLink)
  })

  it('hides the theme shortcut on Settings and the settings shortcut away from the timeline', () => {
    stores.tabSync = { isPrimary: true, databaseStale: false }
    const renderShell = (initialEntry: string) => (
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route index element={<div>Timeline content</div>} />
            <Route path="settings" element={<div>Settings content</div>} />
            <Route path="privacy" element={<div>Privacy content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    )
    let view = render(renderShell('/'))

    expect(screen.getByRole('button', { name: 'Theme: System' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Settings' })).toBeVisible()

    view.unmount()
    view = render(renderShell('/settings'))
    expect(screen.queryByRole('button', { name: 'Theme: System' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument()

    view.unmount()
    render(renderShell('/privacy'))
    expect(screen.getByRole('button', { name: 'Theme: System' })).toBeVisible()
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument()
  })

  it('reopens the closed desktop chat card with the chat shortcut', () => {
    stores.tabSync = { isPrimary: true, databaseStale: false }
    stores.ui.mode = 'chat'
    stores.ui.desktopChatPanelOpen = false
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel')

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route index element={<div>Timeline content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.keyDown(window, { key: 'k', metaKey: true })

    expect(stores.ui.setDesktopChatPanelOpen).toHaveBeenCalledWith(true)
  })

  it('toggles the desktop chat card with the sidebar shortcut while it is open', () => {
    stores.tabSync = { isPrimary: true, databaseStale: false }
    stores.ui.mode = 'chat'
    stores.ui.desktopChatPanelOpen = true
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel')

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route index element={<div>Timeline content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.keyDown(window, { key: 's', metaKey: true, shiftKey: true })

    expect(stores.ui.setMode).toHaveBeenCalledWith('timeline')
  })

  it('delays attention after welcome and hides it immediately when welcome returns', async () => {
    vi.useFakeTimers()
    stores.tabSync = { isPrimary: true, databaseStale: false }
    stores.days = { loaded: false, loading: true, days: [] }
    const renderHome = () => (
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<AppShell />} />
        </Routes>
      </MemoryRouter>
    )
    const { rerender } = render(renderHome())

    await act(async () => undefined)
    expect(screen.queryByRole('button', { name: '2 items need attention' })).not.toBeInTheDocument()

    stores.days = { loaded: true, loading: false, days: [] }
    rerender(renderHome())
    expect(screen.queryByRole('button', { name: '2 items need attention' })).not.toBeInTheDocument()

    stores.days = { loaded: true, loading: false, days: [{}] }
    rerender(renderHome())
    expect(screen.queryByRole('button', { name: '2 items need attention' })).not.toBeInTheDocument()

    act(() => vi.advanceTimersByTime(2999))
    expect(screen.queryByRole('button', { name: '2 items need attention' })).not.toBeInTheDocument()

    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByRole('button', { name: '2 items need attention' })).toBeVisible()

    stores.ui.timelineEmpty = true
    rerender(renderHome())
    expect(screen.queryByRole('button', { name: '2 items need attention' })).not.toBeInTheDocument()
  })

  it('coalesces rapid scroll/resize events into a single rAF-scheduled update, preserving scroll-to-today visibility', () => {
    stores.tabSync = { isPrimary: true, databaseStale: false }

    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    let scrollY = 0
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      get: () => scrollY,
    })

    const rafCallbacks: FrameRequestCallback[] = []
    const rafSpy = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback)
      return rafCallbacks.length
    })
    vi.stubGlobal('requestAnimationFrame', rafSpy)
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const flushRaf = () => {
      const pending = rafCallbacks.splice(0, rafCallbacks.length)
      pending.forEach((callback) => callback(0))
    }

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route index element={<div data-scroll-target="today" />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    const todayTarget = document.querySelector<HTMLElement>("[data-scroll-target='today']")
    if (!todayTarget) throw new Error('today target not rendered')
    const rectSpy = vi.spyOn(todayTarget, 'getBoundingClientRect').mockReturnValue({
      top: -2000,
      bottom: -1990,
      left: 0,
      right: 0,
      width: 0,
      height: 10,
      x: 0,
      y: -2000,
      toJSON: () => undefined,
    } as DOMRect)

    rafSpy.mockClear()
    rectSpy.mockClear()

    scrollY = 3000
    fireEvent.scroll(window)
    fireEvent.scroll(window)
    fireEvent.resize(window)

    expect(rafSpy).toHaveBeenCalledTimes(1)
    expect(rectSpy).not.toHaveBeenCalled()
    expect(screen.queryByTestId('scroll-to-today-visible')).not.toBeInTheDocument()

    act(() => flushRaf())

    expect(rectSpy).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('scroll-to-today-visible')).toBeInTheDocument()

    rafSpy.mockClear()
    rectSpy.mockClear()
    scrollY = 0
    fireEvent.scroll(window)
    act(() => flushRaf())

    expect(screen.queryByTestId('scroll-to-today-visible')).not.toBeInTheDocument()
  })
})

describe('AppShell launcher mode buttons', () => {
  const renderHome = () => (
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<AppShell />}>
          <Route index element={<div>Timeline content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  )

  beforeEach(() => {
    installMatchMedia(false)
    stores.tabSync = { isPrimary: true, databaseStale: false }
    stores.days = { loaded: true, loading: false, days: [{}] }
    stores.settings.dismissedSetupNotices = { ai: true, sync: true }
    stores.settings.llmSecrets = { gemini: { apiKey: 'test-key' } }
    stores.sync.activeProvider = 'google-drive'
    stores.ui.mode = 'timeline'
    stores.ui.chatPanelOpen = false
    stores.ui.desktopChatPanelOpen = false
    stores.ui.chatMessageCount = 0
    stores.ui.timelineEmpty = null
    stores.viewport.isNarrow = false
    stores.ui.setMode.mockClear()
    stores.ui.setDesktopChatPanelOpen.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('opens chat or search from the launcher buttons on desktop timeline mode in Search then Chat order', () => {
    render(renderHome())

    const buttons = screen.getAllByRole('button', { name: /Search|Chat/ })
    expect(buttons[0]).toHaveAccessibleName('Search')
    expect(buttons[1]).toHaveAccessibleName('Chat')
    expect(buttons[0]).toHaveAttribute('type', 'button')
    expect(buttons[1]).toHaveAttribute('type', 'button')
    expect(buttons[0]).toHaveAttribute('aria-controls', 'desktop-search-card')
    expect(buttons[1]).toHaveAttribute('aria-controls', 'desktop-chat-card')
    expect(buttons[0]).toHaveAttribute('aria-expanded', 'false')
    expect(buttons[1]).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(stores.ui.setMode).toHaveBeenCalledExactlyOnceWith('search')

    fireEvent.click(screen.getByRole('button', { name: 'Chat' }))
    expect(stores.ui.setMode).toHaveBeenLastCalledWith('chat')
    expect(stores.ui.setMode).toHaveBeenCalledTimes(2)
  })

  it('clicking the lens while the search card is open returns to the timeline', () => {
    stores.ui.mode = 'search'
    render(renderHome())

    const searchBtn = screen.getByRole('button', { name: 'Hide search' })
    expect(searchBtn).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(searchBtn)

    expect(stores.ui.setMode).toHaveBeenCalledExactlyOnceWith('timeline')
  })

  it('clicking the AI button while the chat card is open returns to the timeline', () => {
    stores.ui.mode = 'chat'
    stores.ui.desktopChatPanelOpen = true
    render(renderHome())

    const chatBtn = screen.getByRole('button', { name: 'Hide chat' })
    expect(chatBtn).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(chatBtn)

    expect(stores.ui.setMode).toHaveBeenCalledExactlyOnceWith('timeline')
  })

  it('marks the open desktop cards on the shell root for the tray layout', () => {
    stores.ui.mode = 'search'
    const view = render(renderHome())

    expect(document.querySelector('.app-shell-root')).toHaveAttribute(
      'data-desktop-search-sidebar-open',
      'true',
    )
    expect(document.querySelector('.app-shell-root')).toHaveAttribute(
      'data-desktop-chat-sidebar-open',
      'false',
    )

    stores.ui.mode = 'chat'
    stores.ui.desktopChatPanelOpen = true
    view.rerender(renderHome())

    expect(document.querySelector('.app-shell-root')).toHaveAttribute(
      'data-desktop-search-sidebar-open',
      'false',
    )
    expect(document.querySelector('.app-shell-root')).toHaveAttribute(
      'data-desktop-chat-sidebar-open',
      'true',
    )
  })

  it('keeps the mobile launcher buttons as plain mode switches', () => {
    stores.viewport.isNarrow = true
    render(renderHome())

    fireEvent.click(screen.getByRole('button', { name: 'Chat' }))
    expect(stores.ui.setMode).toHaveBeenCalledExactlyOnceWith('chat')

    stores.ui.setMode.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(stores.ui.setMode).toHaveBeenCalledExactlyOnceWith('search')
  })

  it('opens chat and sets desktop panel open from AI button in timeline mode', () => {
    stores.ui.mode = 'timeline'
    stores.ui.desktopChatPanelOpen = false
    render(renderHome())

    fireEvent.click(screen.getByRole('button', { name: 'Chat' }))

    expect(stores.ui.setDesktopChatPanelOpen).toHaveBeenCalledWith(true)
    expect(stores.ui.setMode).toHaveBeenCalledWith('chat')
  })

  it('closes open search card on Escape and returns focus to search launcher', () => {
    stores.ui.mode = 'search'
    render(renderHome())

    const searchLauncher = screen.getByRole('button', { name: 'Hide search' })
    expect(searchLauncher).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(stores.ui.setMode).toHaveBeenCalledWith('timeline')
    expect(document.activeElement).toBe(searchLauncher)
  })

  it('closes open chat card on Escape and returns focus to AI chat launcher', () => {
    stores.ui.mode = 'chat'
    stores.ui.desktopChatPanelOpen = true
    render(renderHome())

    const chatLauncher = screen.getByRole('button', { name: 'Hide chat' })
    expect(chatLauncher).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(stores.ui.setMode).toHaveBeenCalledWith('timeline')
    expect(document.activeElement).toBe(chatLauncher)
  })

  it('sets desktopChatPanelOpen true when narrow viewport flips to wide while in chat mode', () => {
    stores.viewport.isNarrow = true
    stores.ui.mode = 'chat'
    stores.ui.desktopChatPanelOpen = false
    const view = render(renderHome())

    expect(stores.ui.setDesktopChatPanelOpen).not.toHaveBeenCalled()

    stores.viewport.isNarrow = false
    view.rerender(renderHome())

    expect(stores.ui.setDesktopChatPanelOpen).toHaveBeenCalledWith(true)
  })

  it('opens search from the timeline with the find shortcut and switches cards with the mode shortcuts', () => {
    stores.ui.mode = 'timeline'
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel')
    const view = render(renderHome())

    fireEvent.keyDown(window, { key: 'f', metaKey: true })
    expect(stores.ui.setMode).toHaveBeenLastCalledWith('search')

    // Cmd+K while the search card is open switches to the chat card.
    stores.ui.mode = 'search'
    stores.ui.setMode.mockClear()
    view.rerender(renderHome())

    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    expect(stores.ui.setMode).toHaveBeenLastCalledWith('chat')
  })
})
