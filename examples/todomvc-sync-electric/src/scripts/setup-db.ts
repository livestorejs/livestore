import { makeDb } from '../server/db.js'

const main = async () => {
  const roomId = process.argv[2]
  if (!roomId) {
    throw new Error('Room ID is required. Pass it as the first argument.')
  }

  const db = makeDb(roomId)

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
