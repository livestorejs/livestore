import { type IntentionalShutdownCause, provideOtel, type UnexpectedError } from '@livestore/common'
import type {
  BaseGraphQLContext,
  BootStatus,
  CreateStoreOptions,
  LiveStoreContext as StoreContext_,
  LiveStoreContextRunning,
  LiveStoreSchema,
  ShutdownDeferred,
  Store,
} from '@livestore/livestore'
import { createStore, StoreAbort, StoreInterrupted } from '@livestore/livestore'
import { LS_DEV } from '@livestore/utils'
import { Deferred, Effect, Exit, identity, Logger, LogLevel, Scope, TaskTracing } from '@livestore/utils/effect'
import * as Solid from 'solid-js'

const interrupt = (
  componentScope: Scope.CloseableScope,
  shutdownDeferred: ShutdownDeferred,
  error: StoreAbort | StoreInterrupted,
) =>
  Effect.gen(function* () {
    // console.log('[@livestore/livestore/react] interupting', error)
    yield* Scope.close(componentScope, Exit.fail(error))
    yield* Deferred.fail(shutdownDeferred, error)
  }).pipe(
    Effect.tapErrorCause((cause) => Effect.logDebug('[@livestore/livestore/solid] interrupting', cause)),
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
  shutdownDeferred: ShutdownDeferred | undefined
  componentScope: Scope.CloseableScope | undefined
  counter: number
} = {
  value: { stage: 'loading' },
  shutdownDeferred: undefined,
  componentScope: undefined,
  counter: 0,
}

const [, setInternalStore] = Solid.createSignal<{
  value: StoreContext_ | BootStatus
  shutdownDeferred: ShutdownDeferred | undefined
  componentScope: Scope.CloseableScope | undefined
  counter: number
}>(storeValue)

export const [storeToExport, setStoreToExport] = Solid.createSignal<LiveStoreContextRunning['store']>()

const setupStore = async <GraphQLContext extends BaseGraphQLContext>({
  schema,
  storeId,
  graphQLOptions,
  boot,
  adapter,
  batchUpdates,
  disableDevtools,
  signal,
  setupDone,
}: CreateStoreOptions<GraphQLContext, LiveStoreSchema> & { signal?: AbortSignal; setupDone: () => void }) => {
  Solid.createEffect(() => {
    const counter = storeValue.counter

    const setContextValue = (value: StoreContext_ | BootStatus) => {
      if (storeValue.counter !== counter) return
      storeValue.value = value
      setInternalStore({
        value: storeValue.value,
        shutdownDeferred: storeValue.shutdownDeferred,
        componentScope: storeValue.componentScope,
        counter: counter + 1,
      })
      if (value.stage === 'running') {
        setStoreToExport(value.store)
      }
    }

    signal?.addEventListener('abort', () => {
      if (
        storeValue.componentScope !== undefined &&
        storeValue.shutdownDeferred !== undefined &&
        storeValue.counter === counter
      ) {
        interrupt(storeValue.componentScope, storeValue.shutdownDeferred, new StoreAbort())
        storeValue.componentScope = undefined
        storeValue.shutdownDeferred = undefined
      }
    })

    Effect.gen(function* () {
      const componentScope = yield* Scope.make()
      const shutdownDeferred = yield* Deferred.make<
        void,
        UnexpectedError | IntentionalShutdownCause | StoreAbort | StoreInterrupted
      >()

      yield* Effect.gen(function* () {
        const store = yield* createStore({
          schema,
          storeId,
          graphQLOptions,
          boot,
          adapter,
          batchUpdates,
          disableDevtools,
          onBootStatus: (status) => {
            if (storeValue.value.stage === 'running' || storeValue.value.stage === 'error') return
            setContextValue(status)
          },
        }).pipe(Effect.tapErrorCause((cause) => Deferred.failCause(shutdownDeferred, cause)))

        setContextValue({ stage: 'running', store })
        setupDone()
      }).pipe(Scope.extend(componentScope), Effect.forkIn(componentScope))

      const shutdownContext = (cause: IntentionalShutdownCause | StoreAbort) =>
        Effect.sync(() => setContextValue({ stage: 'shutdown', cause }))

      yield* Deferred.await(shutdownDeferred).pipe(
        Effect.tapErrorCause((cause) => Effect.logDebug('[@livestore/livestore/react] shutdown', cause)),
        Effect.catchTag('LiveStore.IntentionalShutdownCause', (cause) => shutdownContext(cause)),
        Effect.catchTag('LiveStore.StoreAbort', (cause) => shutdownContext(cause)),
        Effect.tapError((error) => Effect.sync(() => setContextValue({ stage: 'error', error }))),
        Effect.tapDefect((defect) => Effect.sync(() => setContextValue({ stage: 'error', error: defect }))),
        Effect.exit,
      )
    }).pipe(
      Effect.scoped,
      withSemaphore(storeId),
      Effect.withSpan('@livestore/solid:setupStore'),
      LS_DEV ? TaskTracing.withAsyncTaggingTracing((name: string) => (console as any).createTask(name)) : identity,
      provideOtel({}),
      Effect.tapCauseLogPretty,
      Effect.annotateLogs({ thread: 'window' }),
      Effect.provide(Logger.prettyWithThread('window')),
      Logger.withMinimumLogLevel(LogLevel.Debug),
      Effect.runFork,
    )

    Solid.onCleanup(() => {
      if (storeValue.componentScope !== undefined && storeValue.shutdownDeferred !== undefined) {
        interrupt(storeValue.componentScope, storeValue.shutdownDeferred, new StoreInterrupted())
        storeValue.componentScope = undefined
        storeValue.shutdownDeferred = undefined
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
  storeId,
}: Pick<CreateStoreOptions<GraphQLContext, Schema>, 'schema' | 'adapter' | 'storeId'>): Promise<
  Solid.Accessor<Store<BaseGraphQLContext, Schema> | undefined>
> => {
  const setupDone = Promise.withResolvers<void>()

  await setupStore({
    adapter,
    schema,
    storeId,
    setupDone: setupDone.resolve,
  })

  await setupDone.promise

  return storeToExport as unknown as Solid.Accessor<Store<BaseGraphQLContext, Schema>>
}
