import sqliteWasm from 'sqlite-wasm-esm'

const sqlite = await sqliteWasm()

const db = new sqlite.oo1.DB(':memory:')

db.exec(['CREATE TABLE foo (a primary key, b);', 'INSERT INTO foo VALUES (1, 2);'])

const rows = []
db.exec({
  sql: 'SELECT * FROM foo',
  resultRows: rows,
  rowMode: 'object',
})
console.log(rows)
db.close()

console.log('Try running the db in a worker')
new Worker(new URL('./sqlite-worker.ts', import.meta.url), {
  type: 'module',
})
