import WaSqliteFactory from '../../../wa-sqlite/dist/wa-sqlite.node.mjs'
import { MemoryVFS } from '../../../wa-sqlite/src/examples/MemoryVFS.js'
import * as WaSqlite from '../../../wa-sqlite/src/sqlite-api.js'
import { makeSynchronousDatabase } from '../lib/lib.ts'

// TODO better understand changesets and e.g. whether they are invalidated when the db schema changes
const _blob = new Uint8Array([
  84, 3, 0, 0, 1, 97, 112, 112, 0, 23, 0, 3, 1, 49, 0, 3, 5, 83, 84, 57, 116, 115, 3, 0, 0, 0,
])

const _invertedBlob = new Uint8Array([
  84, 3, 0, 0, 1, 97, 112, 112, 0, 23, 0, 3, 0, 0, 3, 5, 83, 84, 57, 116, 115, 3, 1, 49, 0, 0,
])

// console.log('blob length', blob.length)
// console.log('invertedBlob length', invertedBlob.length)

const main = async () => {
  const module = await WaSqliteFactory()
  const sqlite3 = WaSqlite.Factory(module)

  if (sqlite3.vfs_registered.has('memory-vfs') === false) {
    // @ts-expect-error TODO fix types
    const vfs = new MemoryVFS('memory-vfs', (sqlite3 as any).module)

    // @ts-expect-error TODO fix types
    sqlite3.vfs_register(vfs, false)
  }

  // const app = DbSchema.table(
  // 	'app',
  // 	{
  // 		newTodoText: DbSchema.text({ default: '' }),
  // 		filter: DbSchema.text({ schema: Filter, default: 'all' }),
  // 	},
  // 	{ deriveMutations: { enabled: true, localOnly: true } },
  // )

  const db = sqlite3.open_v2Sync(':memory:', undefined, 'memory-vfs')

  const syncDb = makeSynchronousDatabase(sqlite3, db)

  syncDb.execute(
    'CREATE TABLE __livestore_schema (tableName text not null, schemaHash integer not null, updatedAt text not null, PRIMARY KEY (tableName)) strict',
  )
  syncDb.execute(
    'CREATE TABLE __livestore_schema_mutations (mutationName text not null, schemaHash integer not null, updatedAt text not null, PRIMARY KEY (mutationName)) strict',
  )
  syncDb.execute(
    'CREATE TABLE __livestore_session_changeset (idGlobal integer not null, idLocal integer not null, changeset blob not null) strict',
  )
  syncDb.execute(
    'CREATE TABLE todos (id text not null, text text not null default "", completed integer not null default 0, deleted integer, PRIMARY KEY (id)) strict',
  )
  syncDb.execute(
    'CREATE TABLE app (newTodoText text not null default "", filter text not null default "all", id text not null, PRIMARY KEY (id)) strict',
  )

  const stmts = [
    {
      statementSql: 'INSERT INTO app (newTodoText, filter, id) VALUES ($newTodoText, $filter, $id)',
      bindValues: {
        $newTodoText: '',
        $filter: 'all',
        $id: 'QwyUK',
      },
      writeTables: {},
    },
    {
      statementSql: 'UPDATE app SET newTodoText = $text WHERE id = $sessionId',
      bindValues: {
        $text: '1',
        $sessionId: 'QwyUK',
      },
    },
    {
      statementSql: 'INSERT INTO todos (id, text, completed) VALUES ($id, $text, false)',
      bindValues: {
        $id: '24a5ca89-53a6-4ebf-8733-65ce92225f84',
        $text: '1',
      },
    },
    {
      statementSql: 'UPDATE app SET newTodoText = $text WHERE id = $sessionId',
      bindValues: {
        $text: '',
        $sessionId: 'QwyUK',
      },
    },
  ]

  const changesets: Uint8Array<ArrayBuffer>[] = []

  for (const stmt of stmts) {
    const session = sqlite3.session_create(db, 'main')
    sqlite3.session_attach(session, null)
    syncDb.execute(stmt.statementSql, stmt.bindValues)
    changesets.push(sqlite3.session_changeset(session).changeset!)
  }

  console.log('app', syncDb.select('SELECT * FROM app'))
  console.log('changesets', changesets.length, changesets)

  for (let i = changesets.length - 1; i >= 0; i--) {
    const inverted = sqlite3.changeset_invert(changesets[i]!)
    sqlite3.changeset_apply(db, inverted)
    console.log(`app[${i}]`, syncDb.select('SELECT * FROM app'))
  }

  // const session = sqlite3.session_create(db, 'main')
  // sqlite3.session_attach(session, null)

  // syncDb.execute('INSERT INTO app (id, newTodoText) VALUES (?, ?)', ['ST9ts', 'test'])

  // const changeset = sqlite3.session_changeset(session).changeset
  // sqlite3.session_delete(session)
  // console.log('changeset', changeset)

  // const inverted = sqlite3.changeset_invert(changeset!)
  // console.log('inverted', inverted)
  // const inverted2 = sqlite3.changeset_invert(inverted!)
  // console.log('inverted2', inverted2)

  // console.log('res1', syncDb.select('SELECT * FROM app'))

  // sqlite3.changeset_apply(db, invertedBlob)
  // sqlite3.changeset_apply(db, blob)
  // const inverted = sqlite3.changeset_invert(blob)
  // sqlite3.changeset_apply(db, inverted)

  // console.log('res2', syncDb.select('SELECT * FROM app'))

  // syncDb.execute('INSERT INTO todo (id, title, completed, deleted) VALUES (?, ?, ?, ?)', ['t2', 't2', 0, null])

  // console.log('res1', syncDb.select('SELECT * FROM todo'))
  // console.log('res2', syncDb.select('SELECT * FROM todo'))
}

main().catch(console.error)
