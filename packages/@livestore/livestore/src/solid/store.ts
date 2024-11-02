import type { IntentionalShutdownCause, UnexpectedError } from '@livestore/common'
import type {
  BaseGraphQLContext,
  BootStatus,
  DbSchema,
  LiveQuery,
  LiveStoreSchema,
  RowResult,
} from '@livestore/livestore'
import { createStore, rowQuery } from '@livestore/livestore'
import { Effect, FiberSet, Logger, LogLevel } from '@livestore/utils/effect'
import type { Accessor } from 'solid-js'
import { createEffect, createSignal, onCleanup } from 'solid-js'

import type { GetResult, LiveQueryAny } from '../reactiveQueries/base-class.js'
import type { CreateStoreOptions, Store } from '../store.js'
import type { LiveStoreContext as StoreContext_, LiveStoreContextRunning } from '../store-context.js'
import { StoreAbort, StoreInterrupted } from '../store-context.js'

const interrupt = (fiberSet: FiberSet.FiberSet, error: StoreAbort | StoreInterrupted) =>
  Effect.gen(function* () {
    yield* FiberSet.clear(fiberSet)
    yield* FiberSet.run(fiberSet, Effect.fail(error))
  }).pipe(
    Effect.tapErrorCause((cause) => Effect.logDebug(`[@livestore/livestore/react] interupting`, cause)),
    Effect.runFork,
  )

type SchemaKey = string
const semaphoreMap = new Map<SchemaKey, Effect.Semaphore>()
const withSemaphore = (schemaKey: SchemaKey) => {
  let semaphore = semaphoreMap.get(schemaKey)
  if (!semaphore) {
    semaphore = Effect.makeSemaphore(1).pipe(Effect.runSync)
    semaphoreMap.set(schemaKey, semaphore)
  }
  return semaphore.withPermits(1)
}

const storeValue: {
  value: StoreContext_ | BootStatus
  fiberSet: FiberSet.FiberSet | undefined
  counter: number
} = {
  value: { stage: 'loading' },
  fiberSet: undefined,
  counter: 0,
}

const [internalStore, setInternalStore] = createSignal<{
  value: StoreContext_ | BootStatus
  fiberSet: FiberSet.FiberSet | undefined
  counter: number
}>(storeValue)

const [storeToExport, setStoreToExport] = createSignal<LiveStoreContextRunning['store']>()

const setupStore = async <GraphQLContext extends BaseGraphQLContext>({
  schema,
  graphQLOptions,
  otelOptions,
  boot,
  adapter,
  batchUpdates,
  disableDevtools,
  reactivityGraph,
  signal,
}: CreateStoreOptions<GraphQLContext, LiveStoreSchema> & { signal?: AbortSignal }) => {
  createEffect(async () => {
    const counter = storeValue.counter

    const setContextValue = (value: StoreContext_ | BootStatus) => {
      if (storeValue.counter !== counter) return
      storeValue.value = value
      setInternalStore({
        value: storeValue.value,
        fiberSet: storeValue.fiberSet,
        counter: counter + 1,
      })
      if (value.stage === 'running') {
        setStoreToExport(value.store)
      }
    }

    signal?.addEventListener('abort', () => {
      if (storeValue.fiberSet !== undefined && storeValue.counter === counter) {
        interrupt(storeValue.fiberSet, new StoreAbort())
        storeValue.fiberSet = undefined
      }
    })

    await Effect.gen(function* () {
      const fiberSet = yield* FiberSet.make<
        unknown,
        UnexpectedError | IntentionalShutdownCause | StoreAbort | StoreInterrupted
      >()

      storeValue.fiberSet = fiberSet

      yield* Effect.gen(function* () {
        const newStore = yield* createStore({
          schema,
          adapter,
          fiberSet,
          graphQLOptions,
          otelOptions,
          boot,
          reactivityGraph,
          batchUpdates,
          disableDevtools,
          onBootStatus: (status) => {
            if (storeValue.value.stage === 'running' || storeValue.value.stage === 'error') return
            setContextValue(status)
          },
        })

        setContextValue({ stage: 'running', store: newStore })

        yield* Effect.never
      }).pipe(Effect.scoped, FiberSet.run(fiberSet))

      const shutdownContext = (cause: IntentionalShutdownCause | StoreAbort) =>
        Effect.sync(() => setContextValue({ stage: 'shutdown', cause }))

      yield* FiberSet.join(fiberSet).pipe(
        Effect.catchTag('LiveStore.IntentionalShutdownCause', (cause) => shutdownContext(cause)),
        Effect.catchTag('LiveStore.StoreAbort', (cause) => shutdownContext(cause)),
        Effect.tapError((error) => Effect.sync(() => setContextValue({ stage: 'error', error }))),
        Effect.tapDefect((defect) => Effect.sync(() => setContextValue({ stage: 'error', error: defect }))),
        Effect.exit,
      )
    }).pipe(
      Effect.scoped,
      withSemaphore(schema.key),
      Effect.provide(Logger.pretty),
      Logger.withMinimumLogLevel(LogLevel.Debug),
      Effect.runPromise,
    )

    onCleanup(() => {
      if (storeValue.fiberSet !== undefined) {
        interrupt(storeValue.fiberSet, new StoreInterrupted())
        storeValue.fiberSet = undefined
      }
    })
  })
}

export const getStore = async <
  Schema extends LiveStoreSchema,
  GraphQLContext extends BaseGraphQLContext = BaseGraphQLContext,
>({
  adapter,
  schema,
}: Pick<CreateStoreOptions<GraphQLContext, Schema>, 'schema' | 'adapter'>): Promise<
  Accessor<Store<BaseGraphQLContext, Schema> | undefined>
> => {
  await setupStore({
    adapter,
    schema,
  })

  while (!storeToExport()) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  return storeToExport as unknown as Accessor<Store<BaseGraphQLContext, Schema>>
}

export const query = <TQuery extends LiveQueryAny>(
  query$: TQuery,
  initialValue: GetResult<TQuery>,
): Accessor<GetResult<TQuery>> => {
  const [value, setValue] = createSignal(initialValue)

  const unsubscribe = storeToExport()?.subscribe(query$ as any, setValue)

  onCleanup(() => {
    unsubscribe?.()
  })

  return value
}

export const row = <
  TTableDef extends DbSchema.TableDef<
    DbSchema.DefaultSqliteTableDef,
    boolean,
    DbSchema.TableOptions & { isSingleton: false; deriveMutations: { enabled: true } }
  >,
>(
  table: TTableDef,
  id: string,
): Accessor<RowResult<TTableDef> | undefined> => {
  const [value, setValue] = createSignal<RowResult<TTableDef>>()

  const unsubscribe = rowQuery(table, id).subscribe(setValue)

  onCleanup(() => {
    unsubscribe?.()
  })

  return value
}
