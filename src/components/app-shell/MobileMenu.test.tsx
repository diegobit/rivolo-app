import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MobileMenu from './MobileMenu'
import type { AttentionItem } from '../../lib/attention'
import { TIMELINE_NEW_CHAT_EVENT } from '../../lib/timelineEvents'
import { getEmptySyncStatus } from '../../lib/sync'
import { pullFromSyncAndRefresh, pushToSyncAndRefresh } from '../../store/syncActions'
import { useSettingsStore } from '../../store/useSettingsStore'
import { useSyncStore } from '../../store/useSyncStore'
import { useUIStore } from '../../store/useUIStore'

vi.mock('../../store/syncActions', () => ({
  pullFromSyncAndRefresh: vi.fn(async () => ({ status: 'noop' })),
  pushToSyncAndRefresh: vi.fn(async () => ({ status: 'pushed' })),
  recordBlockedPush: vi.fn(),
  recordSyncAttention: vi.fn(),
}))

vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false }),
  })
})

const touch = (x: number, y: number, identifier = 1) => ({ clientX: x, clientY: y, identifier })

const openMenu = (attentionItems: AttentionItem[] = []) => {
  render(
    <MemoryRouter>
      <MobileMenu
        databaseStale={false}
        syncing={false}
        attentionItems={attentionItems}
        onDismissSetupNotice={vi.fn()}
        onNavigate={vi.fn()}
      />
    </MemoryRouter>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
  return screen.getByRole('dialog', { name: 'Menu' })
}

describe('Mobile menu swipe dismissal', () => {
  beforeEach(() => {
    useUIStore.setState({ mode: 'chat', chatSending: false, chatMessageCount: 2, chatPanelOpen: false })
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    })
  })

  it('dismisses a downward swipe, retaining the scroll lock until exit and restoring focus', async () => {
    const sheet = openMenu()
    fireEvent.touchStart(sheet, { touches: [touch(100, 100)] })
    expect(fireEvent.touchMove(sheet, { touches: [touch(105, 180)] })).toBe(false)
    fireEvent.touchEnd(sheet, { touches: [], changedTouches: [touch(105, 180)] })

    expect(document.querySelector('.mobile-menu-overlay')).toHaveAttribute('data-state', 'closing')
    expect(document.documentElement.style.overflow).toBe('hidden')
    expect(screen.getByRole('button', { name: 'Menu' })).toHaveFocus()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Menu' })).not.toBeInTheDocument())
    expect(document.documentElement.style.overflow).toBe('')
  })

  it.each([
    ['short', 100, 125],
    ['horizontal', 190, 120],
    ['upward', 100, 20],
  ])('keeps the menu open after a %s gesture', (_name, x, y) => {
    const sheet = openMenu()
    fireEvent.touchStart(sheet, { touches: [touch(100, 100)] })
    fireEvent.touchMove(sheet, { touches: [touch(x, y)] })
    fireEvent.touchEnd(sheet, { touches: [], changedTouches: [touch(x, y)] })
    expect(document.querySelector('.mobile-menu-overlay')).toHaveAttribute('data-state', 'open')
  })

  it('leaves a scrolled menu available for native scrolling', () => {
    const sheet = openMenu()
    sheet.scrollTop = 50
    fireEvent.touchStart(sheet, { touches: [touch(100, 100)] })
    expect(fireEvent.touchMove(sheet, { touches: [touch(100, 200)] })).toBe(true)
    fireEvent.touchEnd(sheet, { touches: [], changedTouches: [touch(100, 200)] })
    expect(document.querySelector('.mobile-menu-overlay')).toHaveAttribute('data-state', 'open')
  })

  it.each(['cancel', 'multitouch'])('does not dismiss an interrupted %s gesture', (kind) => {
    const sheet = openMenu()
    fireEvent.touchStart(sheet, { touches: [touch(100, 100)] })
    fireEvent.touchMove(sheet, { touches: [touch(100, 180)] })
    if (kind === 'cancel') fireEvent.touchCancel(sheet)
    else fireEvent.touchStart(sheet, { touches: [touch(100, 180), touch(150, 180, 2)] })
    fireEvent.touchEnd(sheet, { touches: [], changedTouches: [touch(100, 200)] })
    expect(document.querySelector('.mobile-menu-overlay')).toHaveAttribute('data-state', 'open')
  })

  it('blocks an accidental row click after a swipe but allows the next deliberate tap', () => {
    openMenu()
    const row = screen.getByRole('button', { name: 'Search' })
    fireEvent.touchStart(row, { touches: [touch(100, 100)] })
    fireEvent.touchMove(row, { touches: [touch(100, 130)] })
    fireEvent.touchEnd(row, { touches: [], changedTouches: [touch(100, 130)] })
    fireEvent.click(row)
    expect(useUIStore.getState().mode).toBe('chat')
    fireEvent.touchStart(row, { touches: [touch(100, 100)] })
    fireEvent.touchEnd(row, { touches: [], changedTouches: [touch(100, 100)] })
    fireEvent.click(row)
    expect(useUIStore.getState().mode).toBe('search')
  })
})

describe('Mobile menu quick actions', () => {
  const connectedStatus = {
    ...getEmptySyncStatus(),
    connected: true,
    targetName: '/inbox.md',
    lastPullAt: Date.now() - 5 * 60_000,
    lastPushAt: Date.now() - 2 * 60 * 60_000,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    useUIStore.setState({ mode: 'chat', chatSending: false, chatMessageCount: 2, chatPanelOpen: false })
    useSettingsStore.setState({ themePreference: 'light' })
    useSyncStore.setState({
      activeProvider: null,
      status: getEmptySyncStatus(),
      syncing: false,
      syncOperation: null,
      syncAttention: null,
    })
  })

  it.each([
    ['system', 'Auto', '/sun-horizon.svg', 'light'],
    ['light', 'Light', '/sun.svg', 'dark'],
    ['dark', 'Dark', '/moon.svg', 'system'],
  ] as const)('shows the %s theme on the theme tile and cycles on', (preference, state, icon, next) => {
    const updateThemePreference = vi.fn(async () => {})
    useSettingsStore.setState({ themePreference: preference, updateThemePreference })
    openMenu()
    const tile = screen.getByRole('button', { name: `Theme: ${state}` })
    expect(tile.querySelector('img')).toHaveAttribute('src', icon)
    fireEvent.click(tile)
    expect(updateThemePreference).toHaveBeenCalledWith(next)
  })

  it('clears the chat from its tile', () => {
    const onClear = vi.fn()
    window.addEventListener(TIMELINE_NEW_CHAT_EVENT, onClear)
    openMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Clear chat' }))
    expect(onClear).toHaveBeenCalledOnce()
    window.removeEventListener(TIMELINE_NEW_CHAT_EVENT, onClear)
  })

  it('greys out Clear chat while the chat is empty', () => {
    useUIStore.setState({ chatMessageCount: 0 })
    openMenu()
    expect(screen.getByRole('button', { name: 'Clear chat' })).toBeDisabled()
  })

  it('puts the sync setup reminder where pull and push would be', () => {
    openMenu([
      {
        id: 'sync',
        title: 'Cloud sync is off',
        description: 'Everything stays on this device.',
        settingsSectionId: 'settings-sync',
        dismissibleSetupNoticeId: 'sync',
      },
    ])
    const sync = within(screen.getByRole('region', { name: 'Sync' }))
    expect(sync.getByRole('link', { name: /Cloud sync is off/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Pull/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Push/ })).not.toBeInTheDocument()
  })

  it('keeps a quiet setup link once the sync reminder is dismissed', () => {
    openMenu()
    expect(screen.getByRole('link', { name: /Set up cloud sync/ })).toHaveAttribute('href', '/settings#settings-sync')
  })

  it('puts a refused push in place of pull and push when neither can run', () => {
    useSyncStore.setState({
      activeProvider: 'dropbox',
      status: { ...connectedStatus, localDirty: true },
      syncAttention: { operation: 'push', message: 'Dropbox changed remotely.', at: 0, blocked: true },
    })
    openMenu([
      {
        id: 'sync-attention',
        title: 'Sync needs attention',
        description: 'Dropbox changed remotely.',
        settingsSectionId: 'settings-sync',
      },
    ])
    const sync = within(screen.getByRole('region', { name: 'Sync • Dropbox' }))
    expect(sync.getByRole('link', { name: /Sync needs attention/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Pull/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Push/ })).not.toBeInTheDocument()
  })

  it('shows sync problems in the Sync section and other warnings on top', () => {
    useSyncStore.setState({ activeProvider: 'dropbox', status: connectedStatus })
    openMenu([
      {
        id: 'sync-attention',
        title: 'Sync needs attention',
        description: 'Dropbox changed remotely. Choose which copy to keep.',
        settingsSectionId: 'settings-sync',
      },
      {
        id: 'ai',
        title: "AI assistant isn't set up",
        description: 'Open a provider and add an API key.',
        settingsSectionId: 'settings-ai',
        dismissibleSetupNoticeId: 'ai',
      },
    ])
    const sync = within(screen.getByRole('region', { name: 'Sync • Dropbox' }))
    expect(sync.getByRole('link', { name: /Sync needs attention/ })).toBeInTheDocument()
    expect(sync.queryByRole('link', { name: /AI assistant/ })).not.toBeInTheDocument()
    expect(sync.getByRole('button', { name: 'Pull, 5m ago' })).toBeInTheDocument()
  })

  it('shows when each sync direction last ran and runs it on tap', () => {
    useSyncStore.setState({ activeProvider: 'dropbox', status: connectedStatus })
    openMenu()
    const pull = screen.getByRole('button', { name: 'Pull, 5m ago' })
    const push = screen.getByRole('button', { name: 'Push, 2h ago' })
    fireEvent.click(pull)
    expect(pullFromSyncAndRefresh).toHaveBeenCalledTimes(1)
    fireEvent.click(push)
    expect(pushToSyncAndRefresh).toHaveBeenCalledTimes(1)
  })

  it('holds pull back until unsynced edits are pushed', () => {
    useSyncStore.setState({ activeProvider: 'dropbox', status: { ...connectedStatus, localDirty: true } })
    openMenu()
    expect(screen.getByRole('button', { name: 'Pull, Push first' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Push, 2h ago, unsynced edits' })).toBeEnabled()
  })
})
