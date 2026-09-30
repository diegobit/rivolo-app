import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TIMELINE_NEW_CHAT_EVENT, TIMELINE_SCROLL_TODAY_EVENT } from '../lib/timelineEvents'
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

  it.each(['timeline', 'chat', 'search'] as const)('shows the mobile dock and no header controls in %s mode', (mode) => {
    stores.tabSync = { isPrimary: true, databaseStale: false }
    stores.settings.llmSecrets = { gemini: { apiKey: 'test-key' } }
    stores.sync.activeProvider = 'google-drive'
    stores.viewport.isNarrow = true
    stores.ui.mode = mode

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route index element={<div>Timeline content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    // The top bar keeps the brand but has no controls: they live in the dock.
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Theme: System' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Shortcuts' })).not.toBeInTheDocument()
    // The brand is in the shell header whenever the full-screen chat is not up
    // (with no messages there is no overlay, even in chat mode).
    expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveClass('pt-0')
    expect(screen.getByRole('main')).toHaveStyle({ paddingBottom: 'var(--mobile-home-bottom-clearance)' })
    const dock = screen.getByRole('navigation', { name: 'Mobile navigation' })
    expect(dock).toBeVisible()
    expect(screen.getByRole('button', { name: mode === 'timeline' ? 'Today' : mode === 'chat' ? 'Chat' : 'Search' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Menu' })).toBeVisible()
    expect(screen.queryByRole('button', { name: /Switch to/ })).not.toBeInTheDocument()
    if (mode === 'timeline') {
      expect(document.querySelector('#bottom-tray')).not.toBeInTheDocument()
    } else {
      expect(document.querySelector('#bottom-tray')).toBeInTheDocument()
    }
  })

  it('hands the brand to the full-screen chat overlay when a thread is up', () => {
    stores.tabSync = { isPrimary: true, databaseStale: false }
    stores.viewport.isNarrow = true
    stores.ui.mode = 'chat'
    stores.ui.chatMessageCount = 1

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route index element={<div>Timeline content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.queryByRole('link', { name: 'Home' })).not.toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible()
  })

  it('brings today back on screen when the Today destination is tapped', async () => {
    stores.tabSync = { isPrimary: true, databaseStale: false }
    stores.viewport.isNarrow = true
    stores.ui.mode = 'search'
    const onScrollToday = vi.fn()
    window.addEventListener(TIMELINE_SCROLL_TODAY_EVENT, onScrollToday)

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route index element={<div>Timeline content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Today' }))

    expect(stores.ui.setMode).toHaveBeenCalledWith('timeline')
    await waitFor(() => expect(onScrollToday).toHaveBeenCalled())

    window.removeEventListener(TIMELINE_SCROLL_TODAY_EVENT, onScrollToday)
  })

  it('opens Chat when New chat is used from another destination', async () => {
    stores.tabSync = { isPrimary: true, databaseStale: false }
    stores.viewport.isNarrow = true
    stores.ui.mode = 'search'
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

    await userEvent.click(screen.getByRole('button', { name: 'Menu' }))
    await userEvent.click(await screen.findByRole('button', { name: 'New chat' }))

    expect(stores.ui.setMode).toHaveBeenCalledWith('chat')
    expect(onNewChat).toHaveBeenCalledOnce()

    window.removeEventListener(TIMELINE_NEW_CHAT_EVENT, onNewChat)
  })

  it('releases Menu inert state when the viewport crosses into desktop mode', async () => {
    stores.tabSync = { isPrimary: true, databaseStale: false }
    stores.viewport.isNarrow = true
    const shell = () => (
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route index element={<div>Timeline content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    )
    const view = render(shell())

    await userEvent.click(screen.getByRole('button', { name: 'Menu' }))
    expect(view.container.querySelector('main')).toHaveAttribute('inert')

    stores.viewport.isNarrow = false
    view.rerender(shell())
    await waitFor(() => expect(view.container.querySelector('main')).not.toHaveAttribute('inert'))
  })

  it('keeps the welcome hero clean: the bottom bar fades out with it on mobile', () => {
    stores.tabSync = { isPrimary: true, databaseStale: false }
    stores.viewport.isNarrow = true
    stores.ui.mode = 'chat'
    document.body.dataset.heroUi = 'true'

    try {
      render(
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<AppShell />}>
              <Route index element={<div>Timeline content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>,
      )

      // The hero is clean: the row (composer + dock) fades out with it.
      expect(document.querySelector('.bottom-tray-row')).toHaveClass('hero-ui-fade-down')
    } finally {
      delete document.body.dataset.heroUi
    }
  })

  it('offers new chat and settings from the mobile menu before chat has messages', async () => {
    stores.tabSync = { isPrimary: true, databaseStale: false }
    stores.viewport.isNarrow = true
    stores.ui.mode = 'chat'
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

    // The brand stays in the shell header; the sheet no longer repeats it.
    expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Menu' }))
    expect(document.querySelector('#mobile-chat-menu img[src="/logo.svg"]')).toBeNull()
    expect(screen.getByRole('button', { name: 'Close menu' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings')
    const newChatButton = await screen.findByRole('button', { name: 'New chat' })
    await userEvent.click(newChatButton)

    expect(onNewChat).toHaveBeenCalledOnce()

    window.removeEventListener(TIMELINE_NEW_CHAT_EVENT, onNewChat)
  })

  it('keeps Menu as its accessible name when the tab needs reloading', async () => {
    stores.viewport.isNarrow = true
    stores.settings.llmSecrets = { gemini: { apiKey: 'test-key' } }
    stores.sync.activeProvider = 'google-drive'

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<AppShell />} />
        </Routes>
      </MemoryRouter>,
    )

    const menuButton = screen.getByRole('button', { name: 'Menu' })
    expect(menuButton).toHaveAccessibleDescription('Reload needed')
    await userEvent.click(menuButton)
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
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
    stores.viewport.isNarrow = true

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
    expect(screen.queryByRole('button', { name: 'Scroll to Today' })).not.toBeInTheDocument()

    act(() => flushRaf())

    expect(rectSpy).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Scroll to Today' })).toBeInTheDocument()

    rafSpy.mockClear()
    rectSpy.mockClear()
    scrollY = 0
    fireEvent.scroll(window)
    act(() => flushRaf())

    expect(screen.queryByRole('button', { name: 'Scroll to Today' })).not.toBeInTheDocument()
  })
})
