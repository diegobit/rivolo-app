type LogPayload = Record<string, unknown>

const DEBUG_LOGS_STORAGE_KEY = 'rivolo:debug-logs'

declare global {
  interface Window {
    __RIVOLO_DEBUG_LOGS__?: boolean
    __RIVOLO_SET_DEBUG_LOGS__?: (enabled: boolean) => void
  }
}

const parseBoolean = (value: string | null) => {
  if (!value) return null

  const normalized = value.trim().toLowerCase()
  if (normalized === '1' || normalized === 'true' || normalized === 'on' || normalized === 'yes') {
    return true
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'off' || normalized === 'no') {
    return false
  }

  return null
}

const envDefault = parseBoolean(import.meta.env.VITE_DEBUG_LOGS ?? null)

export const getDebugLogsStorageKey = () => DEBUG_LOGS_STORAGE_KEY

export const isDebugLogsEnabled = () => {
  if (typeof window === 'undefined') {
    return envDefault ?? false
  }

  if (typeof window.__RIVOLO_DEBUG_LOGS__ === 'boolean') {
    return window.__RIVOLO_DEBUG_LOGS__
  }

  const stored = parseBoolean(window.localStorage.getItem(DEBUG_LOGS_STORAGE_KEY))
  if (stored != null) {
    return stored
  }

  return envDefault ?? false
}

export const setDebugLogsEnabled = (enabled: boolean) => {
  if (typeof window === 'undefined') return

  window.__RIVOLO_DEBUG_LOGS__ = enabled
  window.localStorage.setItem(DEBUG_LOGS_STORAGE_KEY, enabled ? '1' : '0')
}

export const installDebugLogsToggle = () => {
  if (typeof window === 'undefined') return

  if (window.__RIVOLO_SET_DEBUG_LOGS__) return

  window.__RIVOLO_SET_DEBUG_LOGS__ = (enabled: boolean) => {
    setDebugLogsEnabled(enabled)
    console.info('[DebugLogs] toggle', {
      enabled,
      storageKey: DEBUG_LOGS_STORAGE_KEY,
    })
  }
}

export const getNowMs = () => {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }

  return Date.now()
}

export const toElapsedMs = (startedAtMs: number) => {
  return Math.round((getNowMs() - startedAtMs) * 10) / 10
}

export const debugLog = (scope: string, event: string, payload?: LogPayload) => {
  if (!isDebugLogsEnabled()) return

  if (payload) {
    console.info(`[${scope}] ${event}`, payload)
    return
  }

  console.info(`[${scope}] ${event}`)
}

export const debugWarn = (scope: string, event: string, payload?: LogPayload) => {
  if (!isDebugLogsEnabled()) return

  if (payload) {
    console.warn(`[${scope}] ${event}`, payload)
    return
  }

  console.warn(`[${scope}] ${event}`)
}

export const startDebugTimer = (scope: string, event: string, payload?: LogPayload) => {
  if (!isDebugLogsEnabled()) {
    return {
      end: () => undefined,
    }
  }

  const startedAtMs = getNowMs()
  debugLog(scope, `${event}:start`, payload)

  return {
    end: (endEvent = `${event}:end`, endPayload?: LogPayload) => {
      debugLog(scope, endEvent, {
        elapsedMs: toElapsedMs(startedAtMs),
        ...endPayload,
      })
    },
  }
}
