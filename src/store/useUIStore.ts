import { create } from 'zustand'

type Mode = 'timeline' | 'chat' | 'search'

type UIState = {
  mode: Mode
  chatPanelOpen: boolean
  desktopChatPanelOpen: boolean
  chatMessageCount: number
  setMode: (mode: Mode) => void
  setChatPanelOpen: (open: boolean) => void
  setDesktopChatPanelOpen: (open: boolean) => void
  setChatMessageCount: (count: number) => void
}

const getDefaultChatPanelOpen = () => {
  if (typeof window === 'undefined') return true
  return !window.matchMedia('(max-width: 767px)').matches
}

const getDefaultDesktopChatPanelOpen = () => {
  if (typeof window === 'undefined') return true
  return !window.matchMedia('(max-width: 767px)').matches
}

const isNarrowViewport = () => {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(max-width: 767px)').matches
}

export const useUIStore = create<UIState>((set) => ({
  mode: 'chat',
  chatPanelOpen: getDefaultChatPanelOpen(),
  desktopChatPanelOpen: getDefaultDesktopChatPanelOpen(),
  chatMessageCount: 0,
  setMode: (mode) =>
    set((state) => ({
      mode,
      chatPanelOpen: mode === 'chat' && isNarrowViewport() ? true : state.chatPanelOpen,
      desktopChatPanelOpen:
        mode === 'chat' && !isNarrowViewport() ? true : state.desktopChatPanelOpen,
    })),
  setChatPanelOpen: (open) => set({ chatPanelOpen: open }),
  setDesktopChatPanelOpen: (open) => set({ desktopChatPanelOpen: open }),
  setChatMessageCount: (count) => set({ chatMessageCount: count }),
}))
