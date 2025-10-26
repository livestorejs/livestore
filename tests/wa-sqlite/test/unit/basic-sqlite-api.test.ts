import type { SQLiteAPI } from '@livestore/wa-sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeSynchronousDatabase } from '../lib/lib.ts'
import { loadSqlite3Wasm, makeInMemoryDb } from '../lib/sqlite-utils.ts'

describe('Basic SQLite Synchronous API', () => {
  let sqlite3: SQLiteAPI
  let db: number
  let syncDb: ReturnType<typeof makeSynchronousDatabase>

  beforeEach(async () => {
    sqlite3 = await loadSqlite3Wasm()
    db = makeInMemoryDb(sqlite3)
    syncDb = makeSynchronousDatabase(sqlite3, db)
  })

  afterEach(() => {
    syncDb?.close()
  })

  it('should create and execute basic SQL statements', () => {
    // Create table
    syncDb.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER)')

    // Insert data
    syncDb.execute('INSERT INTO users (name, age) VALUES (?, ?)', ['Alice', 30])
    syncDb.execute('INSERT INTO users (name, age) VALUES (?, ?)', ['Bob', 25])

    // Select data
    const users = syncDb.select<{ id: number; name: string; age: number }>('SELECT * FROM users ORDER BY id')

    expect(users).toHaveLength(2)
    expect(users[0]).toEqual({ id: 1, name: 'Alice', age: 30 })
    expect(users[1]).toEqual({ id: 2, name: 'Bob', age: 25 })
  })

  it('should handle prepared statements', () => {
    syncDb.execute('CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, price REAL)')

    const insertStmt = syncDb.prepare('INSERT INTO products (name, price) VALUES (?, ?)')

    insertStmt.execute(['Laptop', 999.99])
    insertStmt.execute(['Mouse', 29.99])
    insertStmt.finalize()

    const products = syncDb.select<{ id: number; name: string; price: number }>('SELECT * FROM products ORDER BY id')

    expect(products).toHaveLength(2)
    expect(products[0]).toEqual({ id: 1, name: 'Laptop', price: 999.99 })
    expect(products[1]).toEqual({ id: 2, name: 'Mouse', price: 29.99 })
  })

  it('should handle transactions', () => {
    syncDb.execute('CREATE TABLE accounts (id INTEGER PRIMARY KEY, balance REAL)')
    syncDb.execute('INSERT INTO accounts (balance) VALUES (1000), (500)')

    // Begin transaction
    syncDb.execute('BEGIN TRANSACTION')

    try {
      syncDb.execute('UPDATE accounts SET balance = balance - ? WHERE id = ?', [100, 1])
      syncDb.execute('UPDATE accounts SET balance = balance + ? WHERE id = ?', [100, 2])

      // Commit transaction
      syncDb.execute('COMMIT')
    } catch (error) {
      syncDb.execute('ROLLBACK')
      throw error
    }

    const accounts = syncDb.select<{ id: number; balance: number }>('SELECT * FROM accounts ORDER BY id')

    expect(accounts[0]?.balance).toBe(900)
    expect(accounts[1]?.balance).toBe(600)
  })

  it('should handle named parameters', () => {
    syncDb.execute('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, category TEXT)')

    syncDb.execute('INSERT INTO items (name, category) VALUES ($name, $category)', {
      $name: 'Book',
      $category: 'Education',
    })

    const items = syncDb.select<{ id: number; name: string; category: string }>(
      'SELECT * FROM items WHERE category = $category',
      { $category: 'Education' },
    )

    expect(items).toHaveLength(1)
    expect(items[0]).toEqual({ id: 1, name: 'Book', category: 'Education' })
  })

  it('should handle different data types', () => {
    syncDb.execute(`
      CREATE TABLE mixed_types (
        id INTEGER PRIMARY KEY,
        text_col TEXT,
        int_col INTEGER,
        real_col REAL,
        blob_col BLOB,
        null_col NULL
      )
    `)

    const blob = new Uint8Array([1, 2, 3, 4])

    syncDb.execute('INSERT INTO mixed_types (text_col, int_col, real_col, blob_col, null_col) VALUES (?, ?, ?, ?, ?)', [
      'Hello',
      42,
      3.14,
      blob,
      null,
    ])

    const result = syncDb.select<{
      id: number
      text_col: string
      int_col: number
      real_col: number
      blob_col: Uint8Array
      null_col: null
    }>('SELECT * FROM mixed_types')

    expect(result).toHaveLength(1)
    expect(result[0]?.text_col).toBe('Hello')
    expect(result[0]?.int_col).toBe(42)
    expect(result[0]?.real_col).toBe(3.14)
    expect(result[0]?.blob_col).toEqual(blob)
    expect(result[0]?.null_col).toBeNull()
  })

  it('should handle database export', () => {
    syncDb.execute('CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)')
    syncDb.execute('INSERT INTO test (value) VALUES (?)', ['test data'])

    const exported = syncDb.export()

    expect(exported).toBeInstanceOf(Uint8Array)
    expect(exported.length).toBeGreaterThan(0)
  })

  it('should track row changes', () => {
    syncDb.execute('CREATE TABLE counter (id INTEGER PRIMARY KEY, count INTEGER DEFAULT 0)')

    let rowsChanged = 0

    syncDb.execute('INSERT INTO counter (count) VALUES (1)', undefined, {
      onRowsChanged: (changed) => {
        rowsChanged = changed
      },
    })

    expect(rowsChanged).toBe(1)

    syncDb.execute('INSERT INTO counter (count) VALUES (2), (3)', undefined, {
      onRowsChanged: (changed) => {
        rowsChanged = changed
      },
    })

    expect(rowsChanged).toBe(2)
  })
})
