export const ANIMATIONS_STORAGE_KEY = 'rivolo.appearance.animations'

// Settings › Appearance › Animations. Turned off, the page root carries
// data-animations="off", which index.css uses to make every transition and
// animation instant. The IndexedDB setting is authoritative; the localStorage
// mirror lets index.html apply it before the first paint.
export const syncAnimationsPreference = (enabled: boolean) => {
  if (typeof document === 'undefined') return

  try {
    window.localStorage.setItem(ANIMATIONS_STORAGE_KEY, enabled ? 'true' : 'false')
  } catch {
    // Without the mirror, animations only stop once settings have loaded.
  }

  if (enabled) delete document.documentElement.dataset.animations
  else document.documentElement.dataset.animations = 'off'
}
