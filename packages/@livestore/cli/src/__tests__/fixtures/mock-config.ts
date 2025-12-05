import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Events, makeSchema, State } from '@livestore/common/schema'
import type { MockSyncBackend } from '@livestore/common/sync'
import { EventFactory } from '@livestore/common/testing'
import { Effect, FileSystem, type Mailbox, Schema } from '@livestore/utils/effect'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const items = State.SQLite.table({
  name: 'items',
  columns: {
    id: State.SQLite.text({ primaryKey: true }),
    title: State.SQLite.text({ default: '', nullable: false }),
  },
})

export const events = {
  itemAdded: Events.synced({
    name: 'itemAdded',
    schema: Schema.Struct({ id: Schema.String, title: Schema.String }),
  }),
}

const materializers = State.SQLite.materializers(events, {
  itemAdded: ({ id, title }) => items.insert({ id, title }),
})

const state = State.SQLite.makeState({
  tables: { items },
  materializers,
})

export const schema = makeSchema({ state, events })

const tmpDir = path.join(process.cwd(), 'tmp', 'cli-sync-tests')
const schemaModuleUrl = pathToFileURL(path.join(__dirname, 'mock-config.ts')).href

/** Generates a per-test config module exporting schema, a mock backend, and connection event taps. */
const makeTempConfig = () => {
  const moduleSource = `
import { schema } from ${JSON.stringify(schemaModuleUrl)}
import { makeMockSyncBackend } from '@livestore/common/sync'
import { Effect, Mailbox } from '@livestore/utils/effect'

export const mockBackend = await Effect.runPromise(Effect.scoped(makeMockSyncBackend({ startConnected: true })))
export const connectionEvents = await Effect.runPromise(Mailbox.make<'connect' | 'disconnect'>())

export { schema }

export const syncBackend = (_args) =>
  mockBackend.makeSyncBackend.pipe(
    Effect.tap(() => connectionEvents.offer('connect')),
    Effect.map((backend) => {
      const disconnect = backend.disconnect ?? Effect.void
      return {
        ...backend,
        disconnect: disconnect.pipe(Effect.tap(() => connectionEvents.offer('disconnect'))),
      }
    }),
  )
`

  return moduleSource
}

/**
 * Creates a temporary config module (schema + mock backend) and cleans it up afterwards.
 * Returns the module path plus handles to the backend and connection event mailbox, keeping lifecycle assertions local to each test.
 */
export const useMockConfig = Effect.acquireRelease(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem

    yield* fs.makeDirectory(tmpDir, { recursive: true })

    const tempPath = path.join(tmpDir, `mock-config-${Date.now()}-${Math.random().toString(16).slice(2)}.ts`)
    const moduleSource = makeTempConfig()

    yield* fs.writeFileString(tempPath, moduleSource)

    const mod = (yield* Effect.tryPromise({
      try: () => import(pathToFileURL(tempPath).href),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    })) as {
      mockBackend: MockSyncBackend
      connectionEvents: Mailbox.Mailbox<'connect' | 'disconnect'>
    }

    return { configPath: tempPath, mockBackend: mod.mockBackend, connectionEvents: mod.connectionEvents }
  }),
  ({ configPath }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      yield* fs.remove(configPath, { recursive: false }).pipe(Effect.catchAll(() => Effect.void))
    }),
)

export const makeEventFactory = () =>
  EventFactory.makeFactory(events)({
    client: EventFactory.clientIdentity('cli-test-client'),
    startSeq: 1,
    initialParent: 'root',
  })
