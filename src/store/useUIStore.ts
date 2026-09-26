import { create } from 'zustand'
import { isNarrowViewport } from '../lib/viewport'

type Mode = 'timeline' | 'chat' | 'search'

type UIState = {
  mode: Mode
  chatPanelOpen: boolean
  chatMessageCount: number
  timelineEmpty: boolean | null
  setMode: (mode: Mode) => void
  setChatPanelOpen: (open: boolean) => void
  setChatMessageCount: (count: number) => void
  setTimelineEmpty: (empty: boolean | null) => void
}

const getDefaultChatPanelsOpen = () => {
  if (typeof window === 'undefined') return true
  return !isNarrowViewport()
}

// Desktop homes start on the plain timeline with the two launcher buttons;
// narrow viewports keep the chat composer in the tray as before.
const getDefaultMode = () => {
  if (typeof window === 'undefined') return 'chat'
  return isNarrowViewport() ? 'chat' : 'timeline'
}

export const useUIStore = create<UIState>((set) => ({
  mode: getDefaultMode(),
  chatPanelOpen: getDefaultChatPanelsOpen(),
  chatMessageCount: 0,
  timelineEmpty: null,
  setMode: (mode) => set({ mode }),
  setChatPanelOpen: (open) => set({ chatPanelOpen: open }),
  setChatMessageCount: (count) => set({ chatMessageCount: count }),
  setTimelineEmpty: (empty) => set({ timelineEmpty: empty }),
}))
