import { queryOne, run } from './db'

type SettingRow = {
  value: string
}

export const getSetting = async (key: string) => {
  const row = await queryOne<SettingRow>('SELECT value FROM settings WHERE key = ? LIMIT 1', [key])
  return row?.value ?? null
}

export const setSetting = async (key: string, value: string) => {
  await run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
    key,
    value,
  ])
}

export const getJsonSetting = async <T>(key: string) => {
  const value = await getSetting(key)
  if (!value) return null

  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

export const setJsonSetting = async (key: string, value: unknown) => {
  await setSetting(key, JSON.stringify(value))
}
