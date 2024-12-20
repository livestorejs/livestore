// import { performance } from 'node:perf_hooks'
// console.log('nodeTiming', performance.nodeTiming)

import path from 'node:path'

import { liveStoreVersion } from '@livestore/common'
import type { DbSchema, LiveStoreSchema } from '@livestore/common/schema'
import { createStore, queryDb } from '@livestore/livestore'
import { makeNodeAdapter } from '@livestore/node'
import { Effect, FiberSet, Layer, Logger, OtelTracer } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'
import { Cli, OtelLiveHttp, PlatformNode } from '@livestore/utils/node'

// import { schema, tables } from './schema.js'

const storeIdOption = Cli.Options.text('store-id').pipe(Cli.Options.withDefault('default'))
const baseDirectoryOption = Cli.Options.text('directory').pipe(Cli.Options.withDefault(''))
const schemaPathOption = Cli.Options.text('schema-path')
const enableDevtoolsOption = Cli.Options.boolean('enable-devtools').pipe(Cli.Options.withDefault(false))

const pull = Cli.Command.make('pull', {}, () => Effect.log('Pulling...'))
const push = Cli.Command.make('push', {}, () => Effect.log('Pushing...'))
const live = Cli.Command.make(
  'live',
  {
    baseDirectory: baseDirectoryOption,
    storeId: storeIdOption,
    schemaPath: schemaPathOption,
    enableDevtools: enableDevtoolsOption,
  },
  ({ baseDirectory, storeId, schemaPath, enableDevtools }) =>
    Effect.gen(function* () {
      // const bootStatusQueue = yield* Queue.unbounded<BootStatus>()
      // const schemaPath = new URL('./schema.js', import.meta.url).toString()
      console.log('schemaPath', schemaPath)
      const relativeSchemaPath = path.isAbsolute(schemaPath) ? schemaPath : path.resolve(process.cwd(), schemaPath)
      console.log('relativeSchemaPath', relativeSchemaPath)
      const schema: LiveStoreSchema = yield* Effect.promise(() => import(relativeSchemaPath).then((m) => m.schema))
      const adapter = (yield* makeNodeAdapter({
        schemaPath: relativeSchemaPath,
        makeSyncBackendUrl: import.meta.resolve('@livestore/sync-cf'),
        baseDirectory,
        syncOptions: {
          type: 'cf',
          url: 'ws://localhost:8787/websocket',
          roomId: `todomvc_${storeId}`,
        },
      }))()

      const fiberSet = yield* FiberSet.make()
      const store = yield* createStore({ adapter, fiberSet, schema, storeId, disableDevtools: !enableDevtools })

      const firstTable = schema.tables.values().next().value as DbSchema.TableDef

      const queries$ = queryDb(firstTable.query.orderBy('id', 'desc').limit(10))
      const runtime = yield* Effect.runtime<never>()

      queries$.subscribe((query) => {
        Effect.log('query', query).pipe(Effect.provide(runtime), Effect.runSync)
      })

      // while (true) {
      //   const prompt = yield* Cli.Prompt.text({ message: 'run mutation\n' })
      //   Effect.log('prompt', prompt).pipe(Effect.provide(runtime), Effect.runSync)
      //   // console.log('res', res)
      //   store.mutate(tables.todo.insert({ id: nanoid(), title: prompt }))
      // }

      // yield* Effect.never
      yield* Effect.sleep(400)

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

const command = Cli.Command.make('livestore')
  .pipe(Cli.Command.withSubcommands([client, server]))
  .pipe(Cli.Command.provide(otelLayer))

const cli = Cli.Command.run(command, { name: 'LiveStore CLI', version: liveStoreVersion })

const layer = Layer.mergeAll(PlatformNode.NodeContext.layer, Logger.pretty)

cli(process.argv).pipe(
  Effect.annotateLogs({ thread: 'cli-main' }),
  Effect.provide(layer),
  PlatformNode.NodeRuntime.runMain,
)
