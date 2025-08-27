import * as WaSqlite from '@livestore/wa-sqlite'
import WaSqliteFactory from '@livestore/wa-sqlite/dist/wa-sqlite.node.mjs'
import { MemoryVFS } from '@livestore/wa-sqlite/src/examples/MemoryVFS.js'
import { makeSynchronousDatabase } from '../lib/lib.ts'

const main = async () => {
  const module = await WaSqliteFactory()
  const sqlite3 = WaSqlite.Factory(module)

  if (sqlite3.vfs_registered.has('memory-vfs') === false) {
    // @ts-expect-error TODO fix types
    const vfs = new MemoryVFS('memory-vfs', (sqlite3 as any).module)

    // @ts-expect-error TODO fix types
    sqlite3.vfs_register(vfs, false)
  }

  const db = sqlite3.open_v2Sync(':memory:', undefined, 'memory-vfs')

  const syncDb = makeSynchronousDatabase(sqlite3, db)

  syncDb.execute('CREATE TABLE todo (id TEXT PRIMARY KEY, title TEXT, completed INTEGER)')

  const session = sqlite3.session_create(db, 'main')
  sqlite3.session_attach(session, 'todo')

  syncDb.execute('INSERT INTO todo (id, title, completed) VALUES (?, ?, ?)', ['t2', 't2', 0])

  const changeset = sqlite3.session_changeset(session)
  console.log(changeset)
}

main().catch(console.error)
