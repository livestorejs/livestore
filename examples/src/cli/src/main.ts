// import { performance } from 'node:perf_hooks'
// console.log('nodeTiming', performance.nodeTiming)

import path from 'node:path'

import { makeInMemoryAdapter, makePersistedAdapter } from '@livestore/adapter-node'
import { liveStoreVersion } from '@livestore/common'
import type { DbSchema, LiveStoreSchema } from '@livestore/common/schema'
import { createStore, queryDb } from '@livestore/livestore'
import { makeCfSync } from '@livestore/sync-cf'
import { Effect, Layer, Logger, LogLevel, Option, Schema, Stream } from '@livestore/utils/effect'
import { Cli, OtelLiveHttp, PlatformNode } from '@livestore/utils/node'

const storeIdOption = Cli.Options.text('store-id').pipe(Cli.Options.withDefault('default'))
const baseDirectoryOption = Cli.Options.text('directory').pipe(Cli.Options.withDefault(''))
const schemaPathOption = Cli.Options.text('schema-path')
const enableDevtoolsOption = Cli.Options.boolean('enable-devtools').pipe(Cli.Options.withDefault(false))
const adapterTypeOption = Cli.Options.text('adapter-type').pipe(
  Cli.Options.withSchema(Schema.Literal('persisted', 'in-memory')),
  Cli.Options.withDefault('persisted'),
)

const syncPayloadOption = Cli.Options.text('sync-payload').pipe(
  Cli.Options.withSchema(Schema.parseJson(Schema.JsonValue)),
  Cli.Options.optional,
)

const pull = Cli.Command.make('pull', {}, () => Effect.log('Pulling...'))
const push = Cli.Command.make('push', {}, () => Effect.log('Pushing...'))
const live = Cli.Command.make(
  'live',
  {
    baseDirectory: baseDirectoryOption,
    storeId: storeIdOption,
    schemaPath: schemaPathOption,
    enableDevtools: enableDevtoolsOption,
    adapterType: adapterTypeOption,
    syncPayload: syncPayloadOption,
  },
  ({ baseDirectory, storeId, schemaPath, enableDevtools, adapterType, syncPayload }) =>
    Effect.gen(function* () {
      const relativeSchemaPath = path.isAbsolute(schemaPath) ? schemaPath : path.resolve(process.cwd(), schemaPath)
      // console.log('relativeSchemaPath', relativeSchemaPath)
      const schema: LiveStoreSchema = yield* Effect.promise(() => import(relativeSchemaPath).then((m) => m.schema))

      const adapter =
        adapterType === 'persisted'
          ? makePersistedAdapter({
              schemaPath: relativeSchemaPath,
              workerUrl: new URL('./livestore.worker.js', import.meta.url),
              baseDirectory,
            })
          : makeInMemoryAdapter({
              sync: { backend: makeCfSync({ url: 'ws://localhost:8787' }) },
            })

      const store = yield* createStore({
        adapter,
        schema,
        storeId,
        disableDevtools: !enableDevtools,
        syncPayload: Option.getOrUndefined(syncPayload),
      })

      const firstTable = schema.tables.values().next().value as DbSchema.TableDef

      const queries$ = queryDb(firstTable.query.orderBy('id', 'desc').limit(10))

      yield* store.subscribeStream(queries$).pipe(
        Stream.tap((result) => Effect.log('query', result)),
        Stream.runDrain,
      )

      // while (true) {
      //   const prompt = yield* Cli.Prompt.text({ message: 'run mutation\n' })
      //   Effect.log('prompt', prompt).pipe(Effect.provide(runtime), Effect.runSync)
      //   // console.log('res', res)
      //   store.commit(tables.todo.insert({ id: nanoid(), title: prompt }))
      // }

      // yield* Effect.sleep(400)

      // yield* FiberSet.clear(fiberSet)

      // TODO get rid of this sleep in better handle initial boot/interruption of worker thread
      // const res = store.query(tables.todo.query)
      // console.log('res', res)
    }).pipe(Effect.scoped, Effect.withSpan('@livestore/examples/cli:main')),
)

const client = Cli.Command.make('client').pipe(Cli.Command.withSubcommands([pull, push, live]))

const start = Cli.Command.make('start', {}, () =>
  Effect.gen(function* () {
    yield* Effect.log('Starting...')
    yield* Effect.never
  }),
)

const server = Cli.Command.make('server').pipe(Cli.Command.withSubcommands([start]))

const otelLayer = OtelLiveHttp({ serviceName: 'livestore-cli', skipLogUrl: false })

const command = Cli.Command.make('livestore').pipe(
  Cli.Command.withSubcommands([client, server]),
  Cli.Command.provide(otelLayer),
)

const cli = Cli.Command.run(command, { name: 'LiveStore CLI', version: liveStoreVersion })

const layer = Layer.mergeAll(PlatformNode.NodeContext.layer, Logger.prettyWithThread('cli-main'))

cli(process.argv).pipe(
  Effect.annotateLogs({ thread: 'cli-main' }),
  Logger.withMinimumLogLevel(LogLevel.Debug),
  Effect.provide(layer),
  PlatformNode.NodeRuntime.runMain({ disablePrettyLogger: true }),
)
