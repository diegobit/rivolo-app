import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, type Page } from 'playwright/test'

type PersistedContent = {
  days: { day_id: string; content_md: string }[]
  settings: Record<string, string>
}

const SQLITE_READER = `
import json, sqlite3, sys
from pathlib import Path

uri = Path(sys.argv[1]).as_uri() + "?mode=ro"
# Provider credentials are stored separately in llm.secrets and are never read.
setting_keys = (
    "llm.provider",
    "llm.providers",
    "appearance.theme",
    "appearance.wallpaper",
    "appearance.font",
    "appearance.monospaceFont",
    "appearance.titleFont",
    "setup.dismissedSync",
)
with sqlite3.connect(uri, uri=True) as connection:
    days = [
        {"day_id": day_id, "content_md": content_md}
        for day_id, content_md in connection.execute(
            "SELECT day_id, content_md FROM days ORDER BY day_id"
        )
    ]
    placeholders = ",".join("?" for _ in setting_keys)
    settings = dict(connection.execute(
        f"SELECT key, value FROM settings WHERE key IN ({placeholders})",
        setting_keys,
    ))
print(json.dumps({"days": days, "settings": settings}, ensure_ascii=False))
`

const readNativeDatabaseBytes = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number[] | null>((resolve, reject) => {
        const openRequest = indexedDB.open('keyval-store')
        openRequest.onerror = () => reject(openRequest.error)
        openRequest.onsuccess = () => {
          const database = openRequest.result
          if (!database.objectStoreNames.contains('keyval')) {
            database.close()
            resolve(null)
            return
          }

          const transaction = database.transaction('keyval', 'readonly')
          let bytes: number[] | null = null
          const getRequest = transaction.objectStore('keyval').get('single-note-db')
          getRequest.onerror = () => reject(getRequest.error)
          getRequest.onsuccess = () => {
            const value: unknown = getRequest.result
            if (value == null) return
            if (value instanceof ArrayBuffer) {
              bytes = Array.from(new Uint8Array(value))
            } else if (ArrayBuffer.isView(value)) {
              bytes = Array.from(
                new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
              )
            } else {
              reject(new Error('The saved SQLite snapshot is not binary data.'))
            }
          }
          transaction.oncomplete = () => {
            database.close()
            resolve(bytes)
          }
          transaction.onerror = () => {
            database.close()
            reject(transaction.error)
          }
          transaction.onabort = () => {
            database.close()
            reject(transaction.error ?? new Error('The native snapshot read was aborted.'))
          }
        }
      }),
  )

const decodePersistedContent = (bytes: number[]): PersistedContent => {
  const directory = mkdtempSync(join(tmpdir(), 'rivolo-persisted-content-'))
  const databasePath = join(directory, 'snapshot.sqlite')
  try {
    writeFileSync(databasePath, Buffer.from(bytes))
    return JSON.parse(
      execFileSync('python3', ['-c', SQLITE_READER, databasePath], { encoding: 'utf8' }),
    ) as PersistedContent
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

export async function waitForPersistedContent(
  page: Page,
  predicate: (content: PersistedContent) => boolean,
) {
  await expect
    .poll(async () => {
      const bytes = await readNativeDatabaseBytes(page)
      return Boolean(bytes && predicate(decodePersistedContent(bytes)))
    })
    .toBe(true)
}
