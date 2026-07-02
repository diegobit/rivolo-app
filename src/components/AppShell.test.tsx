import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import AppShell from './AppShell'

const stores = vi.hoisted(() => ({
  settings: {
    loadSettings: vi.fn(),
    wallpaper: 'rivolo-light',
    highlightInputMode: false,
  },
  sync: {
    loadState: vi.fn(),
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
  },
}))

vi.mock('../store/useSettingsStore', () => ({
  useSettingsStore: (selector: (state: typeof stores.settings) => unknown) => selector(stores.settings),
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

describe('AppShell stale tab guard', () => {
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

  it('shows a sync attention indicator that links to settings', () => {
    stores.tabSync = { isPrimary: true, databaseStale: false }
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

    const indicator = screen.getByRole('link', { name: 'Sync needs attention' })
    expect(indicator).toBeVisible()
    expect(indicator).toHaveAttribute('href', '/settings')
  })
})
