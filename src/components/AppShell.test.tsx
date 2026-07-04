import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AppShell from './AppShell'

const stores = vi.hoisted(() => ({
  settings: {
    loadSettings: vi.fn().mockResolvedValue(undefined),
    provider: 'gemini',
    providerSettings: {},
    llmSecrets: {} as Record<string, { apiKey?: string }>,
    dismissedSetupNotices: { ai: false, sync: false },
    dismissSetupNotice: vi.fn().mockResolvedValue(undefined),
    wallpaper: 'rivolo-light',
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
vi.mock('../hooks/useIsNarrowViewport', () => ({ useIsNarrowViewport: () => false }))
vi.mock('../hooks/useKeyboardOffsetCssVar', () => ({ useKeyboardOffsetCssVar: vi.fn() }))
vi.mock('../hooks/useTabSyncState', () => ({
  useTabSyncState: () => stores.tabSync,
}))
vi.mock('./app-shell/useAutoPullSync', () => ({ useAutoPullSync: vi.fn() }))
vi.mock('./app-shell/BottomTrayRow', () => ({ default: () => null }))
vi.mock('./app-shell/ShortcutsPopover', () => ({ default: () => null }))

describe('AppShell attention and stale tab states', () => {
  beforeEach(() => {
    stores.tabSync = { isPrimary: false, databaseStale: true }
    stores.settings.llmSecrets = {}
    stores.settings.dismissedSetupNotices = { ai: false, sync: false }
    stores.settings.dismissSetupNotice.mockClear()
    stores.days = { loaded: true, loading: false, days: [{}] }
    stores.sync.activeProvider = null
    stores.sync.syncAttention = null
    stores.ui.timelineEmpty = null
  })

  afterEach(() => {
    vi.useRealTimers()
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
})
