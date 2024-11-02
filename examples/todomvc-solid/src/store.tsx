// import type { BaseGraphQLContext, LiveStoreSchema } from '@livestore/livestore'
// import { createStore } from '@livestore/livestore'
// import type { LiveStoreContextRunning } from '@livestore/livestore/dist/effect/LiveStore'
// import type { CreateStoreOptions } from '@livestore/livestore/dist/store'
// import type { LiveStoreContext as StoreContext_ } from '@livestore/livestore/dist/store-context'
// import { StoreAbort, StoreInterrupted } from '@livestore/livestore/dist/store-context'
import { getStore } from '@livestore/livestore/solid'
import { makeAdapter } from '@livestore/web'
import LiveStoreSharedWorker from '@livestore/web/shared-worker?sharedworker'

// import { Effect, FiberSet, Logger, LogLevel } from 'effect'
// import { createEffect, createSignal, onCleanup } from 'solid-js'
// import type { BootStatus, IntentionalShutdownCause, UnexpectedError } from '../../../packages/@livestore/common/dist'
import LiveStoreWorker from './livestore.worker?worker'
import { schema } from './schema/index.js'

const adapterFactory = makeAdapter({
  storage: { type: 'opfs' },
  worker: LiveStoreWorker,
  sharedWorker: LiveStoreSharedWorker,
})

// getStore<typeof schema>({
//   adapter: adapterFactory,
//   schema,
// })

// await new Promise((resolve) => setTimeout(resolve, 1000))

export const store = await getStore<typeof schema>({
  adapter: adapterFactory,
  schema,
})

// const interrupt = (fiberSet: FiberSet.FiberSet, error: StoreAbort | StoreInterrupted) =>
//   Effect.gen(function* () {
//     yield* FiberSet.clear(fiberSet)
//     yield* FiberSet.run(fiberSet, Effect.fail(error))
//   }).pipe(
//     Effect.tapErrorCause((cause) => Effect.logDebug(`[@livestore/livestore/react] interupting`, cause)),
//     Effect.runFork,
//   )

// const adapterFactory = makeAdapter({
//   storage: { type: 'opfs' },
//   worker: LiveStoreWorker,
//   sharedWorker: LiveStoreSharedWorker,
// })

// type SchemaKey = string
// const semaphoreMap = new Map<SchemaKey, Effect.Semaphore>()
// const withSemaphore = (schemaKey: SchemaKey) => {
//   let semaphore = semaphoreMap.get(schemaKey)
//   if (!semaphore) {
//     semaphore = Effect.makeSemaphore(1).pipe(Effect.runSync)
//     semaphoreMap.set(schemaKey, semaphore)
//   }
//   return semaphore.withPermits(1)
// }

// const storeValue: {
//   value: StoreContext_ | BootStatus
//   fiberSet: FiberSet.FiberSet | undefined
//   counter: number
// } = {
//   value: { stage: 'loading' },
//   fiberSet: undefined,
//   counter: 0,
// }

// const [internalStore, setInternalStore] = createSignal<{
//   value: StoreContext_ | BootStatus
//   fiberSet: FiberSet.FiberSet | undefined
//   counter: number
// }>(storeValue)

// const [storeToExport, setStoreToExport] = createSignal<LiveStoreContextRunning['store']>()

// const useCreateStore = <GraphQLContext extends BaseGraphQLContext>({
//   schema,
//   graphQLOptions,
//   otelOptions,
//   boot,
//   adapter,
//   batchUpdates,
//   disableDevtools,
//   reactivityGraph,
//   signal,
// }: CreateStoreOptions<GraphQLContext, LiveStoreSchema> & { signal?: AbortSignal }) => {
//   createEffect(() => {
//     const counter = storeValue.counter

//     const setContextValue = (value: StoreContext_ | BootStatus) => {
//       if (storeValue.counter !== counter) return
//       storeValue.value = value
//       setInternalStore({
//         value: storeValue.value,
//         fiberSet: storeValue.fiberSet,
//         counter: counter + 1,
//       })
//       if (value.stage === 'running') {
//         setStoreToExport(value.store)
//       }
//     }

//     signal?.addEventListener('abort', () => {
//       if (storeValue.fiberSet !== undefined && storeValue.counter === counter) {
//         interrupt(storeValue.fiberSet, new StoreAbort())
//         storeValue.fiberSet = undefined
//       }
//     })

//     Effect.gen(function* () {
//       const fiberSet = yield* FiberSet.make<
//         unknown,
//         UnexpectedError | IntentionalShutdownCause | StoreAbort | StoreInterrupted
//       >()

//       storeValue.fiberSet = fiberSet

//       yield* Effect.gen(function* () {
//         const newStore = yield* createStore({
//           schema,
//           adapter,
//           fiberSet,
//           graphQLOptions,
//           otelOptions,
//           boot,
//           reactivityGraph,
//           batchUpdates,
//           disableDevtools,
//           onBootStatus: (status) => {
//             if (storeValue.value.stage === 'running' || storeValue.value.stage === 'error') return
//             setContextValue(status)
//           },
//         })

//         setContextValue({ stage: 'running', store: newStore })

//         yield* Effect.never
//       }).pipe(Effect.scoped, FiberSet.run(fiberSet))

//       const shutdownContext = (cause: IntentionalShutdownCause | StoreAbort) =>
//         Effect.sync(() => setContextValue({ stage: 'shutdown', cause }))

//       yield* FiberSet.join(fiberSet).pipe(
//         Effect.catchTag('LiveStore.IntentionalShutdownCause', (cause) => shutdownContext(cause)),
//         Effect.catchTag('LiveStore.StoreAbort', (cause) => shutdownContext(cause)),
//         Effect.tapError((error) => Effect.sync(() => setContextValue({ stage: 'error', error }))),
//         Effect.tapDefect((defect) => Effect.sync(() => setContextValue({ stage: 'error', error: defect }))),
//         Effect.exit,
//       )
//     }).pipe(
//       Effect.scoped,
//       withSemaphore(schema.key),
//       Effect.provide(Logger.pretty),
//       Logger.withMinimumLogLevel(LogLevel.Debug),
//       Effect.runFork,
//     )

//     onCleanup(() => {
//       if (storeValue.fiberSet !== undefined) {
//         interrupt(storeValue.fiberSet, new StoreInterrupted())
//         storeValue.fiberSet = undefined
//       }
//     })
//   })
// }

// useCreateStore({
//   adapter: adapterFactory,
//   schema: defaultSchema,
// })

// export const store = storeToExport

// // const getStore = function* () {
// //   const fiberSet = yield* FiberSet.make<
// //     unknown,
// //     UnexpectedError | IntentionalShutdownCause | StoreAbort | StoreInterrupted
// //   >()

// //   const newStore = yield* createStore({
// //     schema,
// //     adapter: adapterFactory,
// //     fiberSet,
// //   })

// //   return newStore
// // }

// // await Effect.gen(getStore).pipe(
// //   Effect.scoped,
// //   // NOTE we're running the code above in a semaphore to make sure a previous store is always fully
// //   // shutdown before a new one is created - especially when shutdown logic is async. You can't trust `React.useEffect`.
// //   // Thank you to Mattia Manzati for this idea.
// //   withSemaphore(schema.key),
// //   // Effect.tapCauseLogPretty,
// //   Effect.annotateLogs({ thread: 'window' }),
// //   Effect.provide(Logger.pretty),
// //   Logger.withMinimumLogLevel(LogLevel.Debug),
// //   Effect.runPromise,
// // )
