/**
 * Node adapter app with devtools enabled.
 * This reproduces the issue from https://github.com/bohdanbirdie/livestore-devtools-issue-repro
 *
 * After ~30 seconds, the devtools lose connection to the app.
 *
 * Usage: bun run main.ts
 *
 * Environment variables:
 * - DEVTOOLS_PORT: Port for devtools server (default: 8080)
 * - STORE_ID: Store ID (default: 'test-store')
 */

import path from 'node:path'
import process from 'node:process'

import { makeAdapter } from '@livestore/adapter-node'
import { createStorePromise } from '@livestore/livestore'
import { nanoid } from '@livestore/utils/nanoid'

import { events, schema, tables } from './schema.ts'

const DEVTOOLS_PORT = Number(process.env.DEVTOOLS_PORT) || 8080
const STORE_ID = process.env.STORE_ID ?? 'test-store'
const TMP_DIR = path.join(import.meta.dirname, 'tmp')

const main = async () => {
  console.log(`Starting LiveStore with devtools on port ${DEVTOOLS_PORT}...`)
  console.log(`Store ID: ${STORE_ID}`)
  console.log(`Temp directory: ${TMP_DIR}`)

  const adapter = makeAdapter({
    storage: { type: 'fs', baseDirectory: TMP_DIR },
    clientId: 'test-client',
    devtools: {
      schemaPath: './schema.ts',
      port: DEVTOOLS_PORT,
    },
  })

  const store = await createStorePromise({
    adapter,
    schema,
    storeId: STORE_ID,
  })

  // Create a test todo item
  const todoId = nanoid()
  store.commit(events.todoCreated({ id: todoId, title: 'Test todo created at startup' }))

  const todos = store.query(tables.todo)
  console.log('Current todos:', todos)

  console.log(`Devtools available at: http://localhost:${DEVTOOLS_PORT}/_livestore/node`)
  console.log('Press Ctrl+C to exit')

  // Signal that the server is ready
  console.log('DEVTOOLS_READY')

  // Keep the process running
  await new Promise(() => {})
}

main().catch((err) => {
  console.error('Error starting LiveStore:', err)
  process.exit(1)
})
