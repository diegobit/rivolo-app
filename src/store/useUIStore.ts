import { create } from 'zustand'
import { isNarrowViewport } from '../lib/viewport'

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

const getDefaultChatPanelsOpen = () => {
  if (typeof window === 'undefined') return true
  return !isNarrowViewport()
}

export const useUIStore = create<UIState>((set) => ({
  mode: 'chat',
  chatPanelOpen: getDefaultChatPanelsOpen(),
  desktopChatPanelOpen: getDefaultChatPanelsOpen(),
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
