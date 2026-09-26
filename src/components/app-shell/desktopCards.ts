export type DesktopCard = 'search' | 'chat'

const CARD_IDS: Record<DesktopCard, string> = {
  search: 'desktop-search-card',
  chat: 'desktop-chat-card',
}

/**
 * Whether focus belongs to the card or the launcher capsule (or to nothing in
 * particular), so dismissing the card may move it to the launcher. Focus in a
 * day note or anywhere else is left alone.
 */
export const isFocusOwnedByCard = (card: DesktopCard) => {
  const active = document.activeElement
  if (!active || active === document.body) return true
  if (document.getElementById(CARD_IDS[card])?.contains(active)) return true
  return Boolean(active.closest('.bottom-tray-launchers'))
}

export const focusLauncher = (card: DesktopCard) => {
  document.querySelector<HTMLButtonElement>(`[data-launcher="${card}"]`)?.focus()
}
