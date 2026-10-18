import { flushDatabaseSave, queryOne, runAtomicDatabaseMutation } from './db'
import { executeSql, queryFirstRow } from './sqliteRuntime'

type SettingRow = {
  value: string
}

export const getSetting = async (key: string) => {
  const row = await queryOne<SettingRow>('SELECT value FROM settings WHERE key = ? LIMIT 1', [key])
  return row?.value ?? null
}

export type SettingWriteOptions = { durable?: boolean }

export const setSettings = async (entries: Array<[string, string]>, options: SettingWriteOptions = {}) => {
  if (!entries.length) return
  await runAtomicDatabaseMutation((db) => {
    for (const [key, value] of entries) {
      executeSql(db, 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
        key,
        value,
      ])
    }
  })
  if (options.durable !== false) await flushDatabaseSave()
}

export const setSetting = async (key: string, value: string, options: SettingWriteOptions = {}) => {
  await setSettings([[key, value]], options)
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

export const setJsonSetting = async (key: string, value: unknown, options: SettingWriteOptions = {}) => {
  await setSetting(key, JSON.stringify(value), options)
}

export const updateJsonSetting = async <T = unknown>(
  key: string,
  update: (current: T | null) => T,
  options: SettingWriteOptions = {},
) => {
  let next!: T
  await runAtomicDatabaseMutation((db) => {
    const row = queryFirstRow<SettingRow>(db, 'SELECT value FROM settings WHERE key = ? LIMIT 1', [key])
    let current: T | null = null
    if (row) {
      try {
        current = JSON.parse(row.value) as T
      } catch {
        current = null
      }
    }
    next = update(current)
    executeSql(db, 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
      key,
      JSON.stringify(next),
    ])
  })
  if (options.durable !== false) await flushDatabaseSave()
  return next
}
