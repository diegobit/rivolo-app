export type ThemePreference = 'system' | 'light' | 'dark'

export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'rivolo.appearance.theme'

const THEME_COLOR: Record<ResolvedTheme, string> = {
  light: '#ffffff',
  dark: '#05070b',
}

export const themePreferenceLabels: Record<ThemePreference, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
}

export const isThemePreference = (value: unknown): value is ThemePreference =>
  value === 'system' || value === 'light' || value === 'dark'

export const normalizeThemePreference = (value: unknown): ThemePreference =>
  isThemePreference(value) ? value : 'system'

export const getLocalThemePreference = (): ThemePreference | null => {
  if (typeof window === 'undefined') return null

  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isThemePreference(value) ? value : null
  } catch {
    return null
  }
}

export const persistLocalThemePreference = (preference: ThemePreference) => {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // The IndexedDB setting is authoritative; localStorage only prevents a pre-paint flash.
  }
}

export const resolveThemePreference = (preference: ThemePreference): ResolvedTheme => {
  if (preference !== 'system') return preference
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export const applyThemePreference = (preference: ThemePreference) => {
  if (typeof document === 'undefined') return resolveThemePreference(preference)

  const resolvedTheme = resolveThemePreference(preference)
  const root = document.documentElement
  root.dataset.theme = resolvedTheme
  root.dataset.themePreference = preference
  root.style.colorScheme = resolvedTheme

  const themeColorMeta = document.querySelector<HTMLMetaElement>("meta[name='theme-color']")
  themeColorMeta?.setAttribute('content', THEME_COLOR[resolvedTheme])

  return resolvedTheme
}

export const syncThemePreference = (preference: ThemePreference) => {
  persistLocalThemePreference(preference)
  return applyThemePreference(preference)
}

export const getNextThemePreference = (preference: ThemePreference): ThemePreference => {
  if (preference === 'system') return 'light'
  if (preference === 'light') return 'dark'
  return 'system'
}
