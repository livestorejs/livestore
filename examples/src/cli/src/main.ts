import './polyfill.js'

import { BunContext, BunRuntime } from '@effect/platform-bun'
import { BootStatus, liveStoreVersion } from '@livestore/common'
import { DbSchema, makeSchema } from '@livestore/common/schema'
import { createStore, queryDb } from '@livestore/livestore'
import { makeNodeAdapter } from '@livestore/node'
import { Effect, FiberSet, Queue } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'

// import { Database } from 'bun:sqlite'
import { Cli } from './lib.js'

const makeMockSchema = () => {
  const todo = DbSchema.table(
    'todo',
    {
      id: DbSchema.text({ primaryKey: true }),
      title: DbSchema.text(),
    },
    { deriveMutations: true },
  )

  const tables = { todo }
  const schema = makeSchema({ tables })

  return { schema, tables }
}

const pull = Cli.Command.make('pull', {}, () => Effect.log('Pulling...'))
const push = Cli.Command.make('push', {}, () => Effect.log('Pushing...'))
const live = Cli.Command.make('live', {}, () =>
  Effect.gen(function* () {
    // const bootStatusQueue = yield* Queue.unbounded<BootStatus>()
    const { schema, tables } = makeMockSchema()
    const adapter = (yield* makeNodeAdapter)('test.db')

    const fiberSet = yield* FiberSet.make()
    const store = yield* createStore({ adapter, fiberSet, schema, storeId: 'default' })

    const queries$ = queryDb(tables.todo.query)

    queries$.subscribe((res) => {
      console.log('res', res)
    })

    store.mutate(tables.todo.insert({ id: nanoid(), title: 'Hello, world!' }))

    // const res = store.query(tables.todo.query)
    // console.log('res', res)
  }).pipe(Effect.scoped),
)

const client = Cli.Command.make('client').pipe(Cli.Command.withSubcommands([pull, push, live]))

const start = Cli.Command.make('start', {}, () =>
  Effect.gen(function* () {
    yield* Effect.log('Starting...')
    yield* Effect.never
  }),
)

const server = Cli.Command.make('server').pipe(Cli.Command.withSubcommands([start]))

const command = Cli.Command.make('livestore').pipe(Cli.Command.withSubcommands([client, server]))

const cli = Cli.Command.run(command, { name: 'LiveStore CLI', version: liveStoreVersion })

cli(process.argv).pipe(Effect.provide(BunContext.layer), BunRuntime.runMain)
