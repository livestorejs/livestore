import path from 'node:path'

import { makeAdapter } from '@livestore/adapter-node'
import { liveStoreVersion } from '@livestore/common'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { createStore, queryDb, Schema } from '@livestore/livestore'
import { makeWsSync } from '@livestore/sync-cf/client'
import { OtelLiveHttp } from '@livestore/utils-dev/node'
import { Effect, Layer, Logger, LogLevel, Option, Stream } from '@livestore/utils/effect'
import { Cli } from '@livestore/utils/node'

import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as NodeServices from '@effect/platform-node/NodeServices'
const storeIdOption = Cli.Flag.string('store-id').pipe(Cli.Flag.withDefault('default'))
const baseDirectoryOption = Cli.Flag.string('storage-fs-base-directory').pipe(Cli.Flag.withDefault(''))
const schemaPathOption = Cli.Flag.string('schema-path')
const enableDevtoolsOption = Cli.Flag.boolean('enable-devtools').pipe(Cli.Flag.withDefault(false))
const adapterTypeOption = Cli.Flag.choice('storage', ['fs', 'in-memory']).pipe(Cli.Flag.withDefault('fs'))
const syncPayloadOption = Cli.Flag.string('sync-payload').pipe(Cli.Flag.optional)

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
      const syncPayloadDecoded = yield* Option.match(syncPayload, {
        onNone: () => Effect.succeed(undefined),
        onSome: (payload) =>
          Effect.try({
            try: (): unknown => JSON.parse(payload),
            catch: (cause) => new Error(`Invalid JSON sync payload: ${String(cause)}`),
          }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.JsonValue))),
      })

      const adapter = makeAdapter({
        storage: adapterType === 'fs' ? { type: 'fs', baseDirectory } : { type: 'in-memory' },
        devtools: { schemaPath },
        sync: { backend: makeWsSync({ url: 'ws://localhost:8787' }) },
      })

      const store = yield* createStore({
        adapter,
        schema,
        storeId,
        disableDevtools: !enableDevtools,
        syncPayload: syncPayloadDecoded,
      })

      const firstTable = schema.state.sqlite.tables.values().next().value!

      const queries$ = queryDb(firstTable.orderBy('id', 'desc').limit(10))

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

const otelLayer = OtelLiveHttp({ serviceName: 'livestore-cli', skipLogUrl: false, traceNodeBootstrap: true })

const command = Cli.Command.make('livestore').pipe(
  Cli.Command.withSubcommands([client, server]),
  Cli.Command.provide(otelLayer),
)

const cli = Cli.Command.run(command, { version: liveStoreVersion })

const layer = Layer.mergeAll(NodeServices.layer, Logger.prettyWithThread('cli-main'))

cli.pipe(
  Effect.annotateLogs({ thread: 'cli-main' }),
  Logger.withMinimumLogLevel('Debug'),
  Effect.provide(layer),
  NodeRuntime.runMain(),
)
