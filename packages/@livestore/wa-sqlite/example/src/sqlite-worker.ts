import sqlite3InitModule from 'sqlite-wasm-esm'

sqlite3InitModule().then((sqlite3) => {
  const db = new sqlite3.opfs!.OpfsDb('my-db', 'c')
  // const db = new sqlite3.oo1.DB(":memory:");

  db.exec(['CREATE TABLE IF NOT EXISTS baz (a, b);', 'INSERT INTO baz VALUES (1, 2);'])

  const rows = []
  db.exec({
    sql: 'SELECT * FROM baz',
    resultRows: rows,
    rowMode: 'object',
  })
  console.log(rows)

  db.close()
})
