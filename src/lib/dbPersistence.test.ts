// @vitest-environment node
import initSqlite from '@sqlite.org/sqlite-wasm'
import { get } from 'idb-keyval'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeStorage, createStorage, type Storage } from '../test/helpers/storage'
import { openSerializedDatabase, queryRows } from './sqliteRuntime'

let storage: Storage
beforeEach(async () => { storage = await createStorage(); await storage.db.flushDatabaseSave() })
afterEach(() => { closeStorage(storage) })

const persistedNotes = async () => {
  const bytes = await get<Uint8Array>('single-note-db')
  const db = openSerializedDatabase(await initSqlite(), bytes)
  try {
    return queryRows<{ day_id: string; content_md: string }>(db, 'SELECT day_id, content_md FROM days ORDER BY day_id DESC')
      .map((day) => [day.day_id, day.content_md])
  } finally { db.close() }
}

describe('database IndexedDB commit boundary', () => {
  it('debounces edits and commits the latest serialized notes after the save delay', async () => {
    await storage.repository.saveDay('2026-07-12', 'first', undefined, { markDirty: false })
    await vi.advanceTimersByTimeAsync(399)
    expect(await persistedNotes()).toEqual([])
    await storage.repository.saveDay('2026-07-12', 'latest', undefined, { markDirty: false })
    await vi.advanceTimersByTimeAsync(399)
    expect(await persistedNotes()).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    // Reading the same IDB store waits behind the queued write transaction.
    expect(await persistedNotes()).toEqual([['2026-07-12', 'latest']])
  })

  it('flushes pending edits immediately without requiring the debounce timer', async () => {
    await storage.repository.saveDay('2026-07-12', 'flush now', undefined, { markDirty: false })
    expect(await persistedNotes()).toEqual([])
    await storage.db.flushDatabaseSave()
    expect(await persistedNotes()).toEqual([['2026-07-12', 'flush now']])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('persists a bulk mutation only after all writes complete', async () => {
    await storage.db.runBulkDatabaseMutation(async () => {
      await storage.repository.saveDay('2026-07-12', 'first', undefined, { markDirty: false })
      await vi.advanceTimersByTimeAsync(1000)
      expect(await persistedNotes()).toEqual([])
      await storage.repository.saveDay('2026-07-13', 'second', undefined, { markDirty: false })
    })
    expect(await persistedNotes()).toEqual([['2026-07-13', 'second'], ['2026-07-12', 'first']])
  })
})
