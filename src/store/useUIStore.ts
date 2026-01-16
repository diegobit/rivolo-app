import { create } from 'zustand'

type Mode = 'timeline' | 'chat' | 'search'

type UIState = {
  mode: Mode
  setMode: (mode: Mode) => void
}

export const useUIStore = create<UIState>((set) => ({
  mode: 'timeline',
  setMode: (mode) => set({ mode }),
}))
