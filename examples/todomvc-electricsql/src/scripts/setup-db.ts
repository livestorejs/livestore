import { makeDb } from '../server/db.js'

const main = async () => {
  const db = makeDb()

  await db.migrate()
  console.log('Database migrated')

  await db.disconnect()
}

try {
  await main()
} catch (error) {
  console.error(error)
  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(1)
}
