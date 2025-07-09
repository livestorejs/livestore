import { makeDb } from '../server/db.js'

const main = async () => {
  const storeId = process.argv[2]
  if (!storeId) {
    throw new Error('Store ID is required. Pass it as the first argument.')
  }

  const db = makeDb(storeId)

  await db.migrate()
  console.log('Database migrated')

  await db.disconnect()
}

try {
  await main()
} catch (error) {
  console.error(error)

  process.exit(1)
}
