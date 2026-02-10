import { create } from 'zustand'

type Mode = 'timeline' | 'chat' | 'search'

type UIState = {
  mode: Mode
  chatPanelOpen: boolean
  chatMessageCount: number
  setMode: (mode: Mode) => void
  setChatPanelOpen: (open: boolean) => void
  setChatMessageCount: (count: number) => void
}

const getDefaultChatPanelOpen = () => {
  if (typeof window === 'undefined') return true
  return !window.matchMedia('(max-width: 639px)').matches
}

export const useUIStore = create<UIState>((set) => ({
  mode: 'chat',
  chatPanelOpen: getDefaultChatPanelOpen(),
  chatMessageCount: 0,
  setMode: (mode) =>
    set((state) => ({
      mode,
      chatPanelOpen: mode === 'chat' ? true : state.chatPanelOpen,
    })),
  setChatPanelOpen: (open) => set({ chatPanelOpen: open }),
  setChatMessageCount: (count) => set({ chatMessageCount: count }),
}))
