import sqlite3InitModule from 'crsqlite-wasm-esm'

sqlite3InitModule().then((sqlite3) => {
  const db = new sqlite3.opfs!.OpfsDb('crdb', 'c')
  // const db = new sqlite3.oo1.DB(":memory:");

  db.exec(['CREATE TABLE IF NOT EXISTS baz (a, b);', 'INSERT INTO baz VALUES (1, 2);'])

  const rows = []
  db.exec({
    sql: 'SELECT * FROM baz',
    resultRows: rows,
    rowMode: 'object',
  })
  console.log(rows)

  // you _MUST_ run this before closing `crsql` db connections
  // see -- https://sqlite.org/forum/forumpost/a38be46f01
  db.exec('SELECT crsql_finalize()')
  db.close()
})
