import path from 'node:path'

import { makeAdapter } from '@livestore/adapter-node'
import { liveStoreVersion } from '@livestore/common'
import type { LiveStoreSchema } from '@livestore/common/schema'
import { createStore, queryDb, Schema } from '@livestore/livestore'
import { makeCfSync } from '@livestore/sync-cf/client'
import { Effect, Layer, Logger, LogLevel, Option, Stream } from '@livestore/utils/effect'
import { Cli, PlatformNode } from '@livestore/utils/node'
import { OtelLiveHttp } from '@livestore/utils-dev/node'

const storeIdOption = Cli.Options.text('store-id').pipe(Cli.Options.withDefault('default'))
const baseDirectoryOption = Cli.Options.text('storage-fs-base-directory').pipe(Cli.Options.withDefault(''))
const schemaPathOption = Cli.Options.text('schema-path')
const enableDevtoolsOption = Cli.Options.boolean('enable-devtools').pipe(Cli.Options.withDefault(false))
const adapterTypeOption = Cli.Options.text('storage').pipe(
  Cli.Options.withSchema(Schema.Literal('fs', 'in-memory')),
  Cli.Options.withDefault('fs'),
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

      const adapter = makeAdapter({
        storage: adapterType === 'fs' ? { type: 'fs', baseDirectory } : { type: 'in-memory' },
        devtools: { schemaPath },
        sync: { backend: makeCfSync({ url: 'ws://localhost:8787' }) },
      })

      const store = yield* createStore({
        adapter,
        schema,
        storeId,
        disableDevtools: !enableDevtools,
        syncPayload: Option.getOrUndefined(syncPayload),
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

const cli = Cli.Command.run(command, { name: 'LiveStore CLI', version: liveStoreVersion })

const layer = Layer.mergeAll(PlatformNode.NodeContext.layer, Logger.prettyWithThread('cli-main'))

cli(process.argv).pipe(
  Effect.annotateLogs({ thread: 'cli-main' }),
  Logger.withMinimumLogLevel(LogLevel.Debug),
  Effect.provide(layer),
  PlatformNode.NodeRuntime.runMain({ disablePrettyLogger: true }),
)
