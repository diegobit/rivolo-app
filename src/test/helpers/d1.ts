import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

const migrations = fileURLToPath(new URL('../../../migrations/', import.meta.url))
const openDatabases = new Set<SqliteD1>()

class SqliteStatement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly values: SQLInputValue[] = [],
  ) {}

  bind(...values: SQLInputValue[]) {
    return new SqliteStatement(this.db, this.sql, values)
  }

  async first<Row>(column?: string): Promise<Row | null> {
    const row = this.db.prepare(this.sql).get(...this.values)
    return (column ? row?.[column] : row) as Row ?? null
  }

  async all<Row>() {
    return { success: true, results: this.db.prepare(this.sql).all(...this.values) as Row[] }
  }

  async run() {
    const result = this.db.prepare(this.sql).run(...this.values)
    return {
      success: true,
      meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) },
    }
  }
}

/** Execute repository SQL and constraints; never interpret query text as fake behavior. */
export class SqliteD1 {
  readonly database = new DatabaseSync(':memory:')

  constructor() {
    this.database.exec('PRAGMA foreign_keys = ON')
    for (const migration of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) {
      this.database.exec(readFileSync(`${migrations}/${migration}`, 'utf8'))
    }
    openDatabases.add(this)
  }

  prepare(sql: string) {
    return new SqliteStatement(this.database, sql)
  }

  get<Row = Record<string, SQLInputValue>>(sql: string, ...values: SQLInputValue[]) {
    return this.database.prepare(sql).get(...values) as Row | undefined
  }

  all<Row = Record<string, SQLInputValue>>(sql: string, ...values: SQLInputValue[]) {
    return this.database.prepare(sql).all(...values) as Row[]
  }

  async batch(statements: SqliteStatement[]) {
    this.database.exec('BEGIN')
    try {
      const results = await Promise.all(statements.map(statement => statement.run()))
      this.database.exec('COMMIT')
      return results
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  close() {
    if (!openDatabases.delete(this)) return
    this.database.close()
  }
}

export const closeTestDatabases = () => {
  for (const db of openDatabases) db.close()
}
