// @vitest-environment node

import initSqlite from '@sqlite.org/sqlite-wasm'
import { beforeAll, describe, expect, it } from 'vitest'
import preFts5Base64 from './fixtures/pre-fts5-sqljs.base64?raw'
import { searchDaysInMemory, type Day } from './notesCore'
import {
  ensureDatabaseSchema,
  executeSql,
  exportSerializedDatabase,
  isAtLeastThreeCodePoints,
  openSerializedDatabase,
  queryRows,
  quoteFtsPhrase,
  type RivoloSqlite,
} from './sqliteRuntime'

const decodeFixture = () => Uint8Array.from(Buffer.from(preFts5Base64.trim(), 'base64'))

describe('official SQLite wasm migration', () => {
  let sqlite: RivoloSqlite

  beforeAll(async () => {
    sqlite = await initSqlite()
  })

  it('opens, migrates, exports, and reopens a database produced by sql.js 1.13.0', () => {
    const db = openSerializedDatabase(sqlite, decodeFixture())
    const migration = ensureDatabaseSchema(db)

    expect(migration).toEqual({ ftsAvailable: true, ftsRebuilt: true })
    expect(
      db.selectValue("SELECT sql FROM sqlite_master WHERE name = 'days_fts'"),
    ).toContain("tokenize='trigram'")
    expect(db.selectValue('SELECT day_id FROM days_fts WHERE days_fts MATCH ?', ['"CAF"'])).toBe(
      '2026-07-12',
    )

    const migratedBytes = exportSerializedDatabase(sqlite, db)
    db.close()

    const reopened = openSerializedDatabase(sqlite, migratedBytes)
    expect(ensureDatabaseSchema(reopened)).toEqual({
      ftsAvailable: true,
      ftsRebuilt: false,
    })
    expect(
      reopened.selectObject(
        'SELECT day_id, human_title, content_md, created_at, updated_at FROM days LIMIT 1',
      ),
    ).toEqual({
      day_id: '2026-07-12',
      human_title: 'Legacy day',
      content_md: 'Hello CAFÉ 100%_ Kelvin',
      created_at: 1,
      updated_at: 2,
    })
    expect(reopened.selectValue('SELECT day_id FROM days_fts WHERE days_fts MATCH ?', ['"CAF"'])).toBe(
      '2026-07-12',
    )
    reopened.close()
  })

  it('keeps representative trigram results identical to substring matching', () => {
    const db = openSerializedDatabase(sqlite)
    ensureDatabaseSchema(db)
    const days: Day[] = [
      {
        dayId: '2026-07-12',
        humanTitle: 'Unicode CAFÉ',
        contentMd: 'Hello world\n100%_ literal and "quoted" text\nKelvin scale',
        createdAt: 3,
        updatedAt: 3,
      },
      {
        dayId: '2026-07-11',
        humanTitle: 'Other',
        contentMd: 'Nothing relevant',
        createdAt: 2,
        updatedAt: 2,
      },
    ]

    for (const day of days) {
      executeSql(
        db,
        'INSERT INTO days (day_id, human_title, content_md, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        [day.dayId, day.humanTitle, day.contentMd, day.createdAt, day.updatedAt],
      )
      executeSql(
        db,
        'INSERT INTO days_fts (day_id, human_title, content_md) VALUES (?, ?, ?)',
        [day.dayId, day.humanTitle, day.contentMd],
      )
    }

    for (const query of ['ell', 'café', '100%_', '"quoted"', 'kel']) {
      const candidates = queryRows<{
        day_id: string
        human_title: string
        content_md: string
        created_at: number
        updated_at: number
      }>(
        db,
        `
          SELECT days.day_id, days.human_title, days.content_md, days.created_at, days.updated_at
          FROM days_fts
          INNER JOIN days ON days.day_id = days_fts.day_id
          WHERE days_fts MATCH ?
          ORDER BY days.day_id DESC
        `,
        [quoteFtsPhrase(query)],
      ).map((row) => ({
        dayId: row.day_id,
        humanTitle: row.human_title,
        contentMd: row.content_md,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }))

      expect(searchDaysInMemory(candidates, query)).toEqual(searchDaysInMemory(days, query))
    }

    expect(isAtLeastThreeCodePoints('a')).toBe(false)
    expect(isAtLeastThreeCodePoints('é🙂')).toBe(false)
    expect(isAtLeastThreeCodePoints('é🙂a')).toBe(true)
    db.close()
  })
})
