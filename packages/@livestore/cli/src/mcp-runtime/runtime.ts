import { makeAdapter as makeNodeAdapter } from '@livestore/adapter-node'
import { UnknownError } from '@livestore/common'
import { LiveStoreEvent, SystemTables } from '@livestore/common/schema'
import type { Store } from '@livestore/livestore'
import { createStorePromise } from '@livestore/livestore'
import { Effect, FetchHttpClient, Layer, Option, Schema } from '@livestore/utils/effect'
import { PlatformNode } from '@livestore/utils/node'

import { loadModuleConfig } from '../module-loader.ts'

/** Currently connected store */
let store: Store<any> | undefined

/** Layer providing FileSystem and HttpClient for module loading */
const ModuleLoaderLayer = Layer.mergeAll(PlatformNode.NodeFileSystem.layer, FetchHttpClient.layer)

/**
 * Dynamically imports a module that exports a `makeStore({ storeId }): Promise<Store>` function,
 * calls it with the provided storeId, and caches the Store instance for subsequent tool calls.
 */
export const init = ({
  configPath,
  storeId,
  clientId,
  sessionId,
}: {
  configPath: string
  storeId: string
  clientId?: string
  sessionId?: string
}): Effect.Effect<Store<any>, UnknownError> =>
  Effect.gen(function* () {
    if (!storeId || typeof storeId !== 'string') {
      return yield* UnknownError.make({ cause: new Error('Invalid storeId: expected a non-empty string') })
    }

    const { schema, syncBackendConstructor, syncPayloadSchema, syncPayload } = yield* loadModuleConfig({ configPath })

    // Build Node adapter internally
    const adapter = makeNodeAdapter({
      storage: { type: 'in-memory' },
      ...(clientId ? { clientId } : {}),
      ...(sessionId ? { sessionId } : {}),
      sync: {
        backend: syncBackendConstructor,
        initialSyncOptions: { _tag: 'Blocking', timeout: 5000 },
        onSyncError: 'shutdown',
      },
    })

    // Create the store
    const s = yield* Effect.promise(() =>
      createStorePromise({
        schema,
        storeId,
        adapter,
        disableDevtools: true,
        syncPayload,
        syncPayloadSchema,
      }),
    )

    // Replace existing store if any
    if (store) {
      yield* Effect.promise(async () => {
        try {
          await store!.shutdownPromise()
        } catch {}
      })
    }

    store = s
    return store
  }).pipe(Effect.provide(ModuleLoaderLayer), Effect.withSpan('mcp-runtime:init'))

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

export const query = Effect.fn('mcp-runtime:query')(function* ({
  sql,
  bindValues,
}: { sql: string; bindValues?: readonly any[] | Record<string, unknown> }) {
  const opt = yield* getStore
  if (opt._tag === 'None') {
    return yield* Effect.dieMessage('LiveStore not connected. Call livestore_instance_connect first.')
  }
  const s = opt.value

  const rows = s.query({ query: sql, bindValues: (bindValues as any) ?? [] }) as Array<Record<string, unknown>>
  const jsonRows = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v as Schema.JsonValue])))
  return { rows: jsonRows, rowCount: jsonRows.length }
})

export const commit = Effect.fn('mcp-runtime:commit')(function* ({
  events,
}: { events: ReadonlyArray<{ name: string; args: Schema.JsonValue }> }) {
  const opt = yield* getStore
  if (opt._tag === 'None') {
    return yield* Effect.dieMessage('LiveStore not connected. Call livestore_instance_connect first.')
  }
  const s = opt.value
  const InputEventSchema = LiveStoreEvent.Input.makeSchema(s.schema) as Schema.Schema<any>
  const decoded = events.map((e) => Schema.decodeSync(InputEventSchema)(e))
  s.commit(...decoded)
  return { committed: decoded.length }
})

export const disconnect = Effect.promise(async () => {
  if (store) {
    try {
      await store.shutdownPromise()
    } catch {}
    store = undefined
  }
  return { _tag: 'disconnected' as const }
}).pipe(Effect.withSpan('mcp-runtime:disconnect'))
