import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AppShell from './AppShell'

const stores = vi.hoisted(() => ({
  settings: {
    loadSettings: vi.fn().mockResolvedValue(undefined),
    provider: 'gemini',
    providerSettings: {},
    llmSecrets: { gemini: { apiKey: 'test-key' } } as Record<string, { apiKey?: string }>,
    dismissedSetupNotices: { ai: true, sync: true },
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
    activeProvider: 'google-drive' as string | null,
    status: {
      connected: false,
      targetName: null,
      localDirty: false,
    },
    syncing: false,
    syncOperation: null,
    syncAttention: null as { operation: string; message: string; at: number } | null,
  },
  tabSync: { isPrimary: true, databaseStale: false },
  ui: {
    mode: 'search',
    setMode: vi.fn(),
    chatPanelOpen: false,
    setChatPanelOpen: vi.fn(),
    desktopChatPanelOpen: true,
    setDesktopChatPanelOpen: vi.fn(),
    chatMessageCount: 0,
    timelineEmpty: false as boolean | null,
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
  }: {
    chatButton: React.ReactNode
    searchButton: React.ReactNode
  }) => (
    <>
      {searchButton}
      {chatButton}
    </>
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

describe('AppShell Escape with the real shortcuts popover', () => {
  beforeEach(() => {
    installMatchMedia(false)
    document.head.innerHTML = '<meta name="theme-color" content="#ffffff" />'
    stores.ui.mode = 'search'
    stores.ui.setMode.mockClear()
    stores.viewport.isNarrow = false
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('closes only the shortcuts popover and leaves the search card open', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route index element={<div>Timeline content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Shortcuts' }))
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide search' })).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape', bubbles: true, cancelable: true })

    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument()
    expect(stores.ui.setMode).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Hide search' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Shortcuts' })).toHaveFocus()
  })
})
