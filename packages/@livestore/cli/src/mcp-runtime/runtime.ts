import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { makeAdapter as makeNodeAdapter } from '@livestore/adapter-node'
import { isLiveStoreSchema, LiveStoreEvent, SystemTables } from '@livestore/common/schema'
import type { Store } from '@livestore/livestore'
import { createStorePromise } from '@livestore/livestore'
import { Effect, Option, Schema } from '@livestore/utils/effect'

/** Currently connected store */
let store: Store<any> | undefined

/**
 * Dynamically imports a module that exports a `makeStore({ storeId }): Promise<Store>` function,
 * calls it with the provided storeId, and caches the Store instance for subsequent tool calls.
 */
export const init = ({
  storePath,
  storeId,
  clientId,
  sessionId,
}: {
  storePath: string
  storeId: string
  clientId?: string
  sessionId?: string
}) =>
  Effect.promise(async () => {
    if (!storeId || typeof storeId !== 'string') {
      throw new Error('Invalid storeId: expected a non-empty string')
    }
    // Resolve to absolute path and import as file URL
    const abs = path.isAbsolute(storePath) ? storePath : path.resolve(process.cwd(), storePath)
    const mod = await import(pathToFileURL(abs).href)

    // Validate required exports
    const schema = (mod as any)?.schema
    if (!isLiveStoreSchema(schema)) {
      throw new Error(
        `Module at ${abs} must export a valid LiveStore 'schema'. Ex: export { schema } from './src/livestore/schema.ts'`,
      )
    }

    const syncBackend = (mod as any)?.syncBackend
    if (typeof syncBackend !== 'function') {
      throw new Error(
        `Module at ${abs} must export a 'syncBackend' constructor (e.g., makeWsSync({ url })). Ex: export const syncBackend = makeWsSync({ url })`,
      )
    }

    // Optional: syncPayload for authenticated backends
    const syncPayloadSchemaExport = (mod as any)?.syncPayloadSchema
    const syncPayloadSchema =
      syncPayloadSchemaExport === undefined
        ? Schema.JsonValue
        : Schema.isSchema(syncPayloadSchemaExport)
          ? (syncPayloadSchemaExport as Schema.Schema<any, any, any>)
          : (() => {
              throw new Error(
                `Exported 'syncPayloadSchema' from ${abs} must be an Effect Schema (received ${typeof syncPayloadSchemaExport}).`,
              )
            })()

    const syncPayloadExport = (mod as any)?.syncPayload
    const syncPayload =
      syncPayloadExport === undefined
        ? undefined
        : (() => {
            try {
              return Schema.decodeSync(syncPayloadSchema)(syncPayloadExport)
            } catch (error) {
              throw new Error(
                `Failed to decode 'syncPayload' from ${abs} using the provided schema: ${(error as Error).message}`,
              )
            }
          })()

    // Build Node adapter internally
    const adapter = makeNodeAdapter({
      storage: { type: 'in-memory' },
      ...(clientId ? { clientId } : {}),
      ...(sessionId ? { sessionId } : {}),
      sync: {
        backend: syncBackend as any,
        initialSyncOptions: { _tag: 'Blocking', timeout: 5000 },
        onSyncError: 'shutdown',
      },
    })

    // Create the store
    const s = await createStorePromise({
      schema,
      storeId,
      adapter,
      disableDevtools: true,
      syncPayload,
      syncPayloadSchema,
    })

    // Replace existing store if any
    if (store) {
      try {
        await store.shutdownPromise()
      } catch {}
    }

    store = s
    return store
  })

export const getStore = Effect.sync(() => Option.fromNullable(store))

export const status = Effect.gen(function* () {
  const opt = yield* getStore
  if (opt._tag === 'None') {
    return {
      _tag: 'disconnected' as const,
    }
  }
  const s = opt.value
  const tableCounts = (Array.from(s.schema.state.sqlite.tables.keys()) as string[])
    .filter((name) => !SystemTables.isStateSystemTable(name))
    .reduce(
      (acc, name) => {
        acc[name] = s.query(s.schema.state.sqlite.tables.get(name)!.count())
        return acc
      },
      {} as Record<string, number>,
    )

  return {
    _tag: 'connected' as const,
    storeId: s.storeId,
    clientId: s.clientId,
    sessionId: s.sessionId,
    tableCounts,
  }
}).pipe(Effect.withSpan('mcp-runtime:status'))

export const query = ({ sql, bindValues }: { sql: string; bindValues?: readonly any[] | Record<string, unknown> }) =>
  Effect.gen(function* () {
    const opt = yield* getStore
    if (opt._tag === 'None') {
      return yield* Effect.dieMessage('LiveStore not connected. Call livestore_instance_connect first.')
    }
    const s = opt.value

    const rows = s.query({ query: sql, bindValues: (bindValues as any) ?? [] }) as Array<Record<string, unknown>>
    const jsonRows = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v as Schema.JsonValue])))
    return { rows: jsonRows, rowCount: jsonRows.length }
  }).pipe(Effect.withSpan('mcp-runtime:query'))

export const commit = ({ events }: { events: ReadonlyArray<{ name: string; args: Schema.JsonValue }> }) =>
  Effect.gen(function* () {
    const opt = yield* getStore
    if (opt._tag === 'None') {
      return yield* Effect.dieMessage('LiveStore not connected. Call livestore_instance_connect first.')
    }
    const s = opt.value
    const PartialEventSchema = LiveStoreEvent.makeEventDefPartialSchema(s.schema) as Schema.Schema<any>
    const decoded = events.map((e) => Schema.decodeSync(PartialEventSchema)(e))
    s.commit(...decoded)
    return { committed: decoded.length }
  }).pipe(Effect.withSpan('mcp-runtime:commit'))

export const disconnect = Effect.promise(async () => {
  if (store) {
    try {
      await store.shutdownPromise()
    } catch {}
    store = undefined
  }
  return { _tag: 'disconnected' as const }
}).pipe(Effect.withSpan('mcp-runtime:disconnect'))
