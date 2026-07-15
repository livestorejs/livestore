import { describe, it } from 'vitest'

import { type OtelTracer, Effect, Layer } from '@livestore/utils/effect'

import { schema } from '../utils/tests/fixture.ts'
import { Store, type StoreTagClass } from './LiveStore.ts'

/**
 * Regression test for https://github.com/livestorejs/livestore/issues/1103
 *
 * `yield* MyStore` and `MyStore.query(...)` must produce the same R channel type
 * so that a single layer provision satisfies both.
 */
describe('Store.Tag R channel consistency', () => {
  class MainStore extends Store.Tag(schema, 'main') {}

  const storeLayer = MainStore.layer({ adapter: {} as any, batchUpdates: (_: () => void) => {} })

  it('yield* and method R channels unify so layer provision eliminates all requirements', () => {
    const prog = Effect.gen(function* () {
      const { store } = yield* MainStore
      void store

      const _queryResult = yield* MainStore.query({ get: () => 42 } as any)
      void _queryResult

      yield* MainStore.commit()
    })

    /** Providing the store layer must fully eliminate MainStore from R */
    const _provided: Effect.Effect<void, unknown, OtelTracer.OtelTracer> = prog.pipe(Effect.provide(storeLayer))
    // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- regression test (issue #1103) asserts only the R channel; the error channel is intentionally widened to `unknown` to stay decoupled from the exact error type
    void _provided
  })

  it('use() helper R channel is satisfied by the same layer', () => {
    const prog = MainStore.use(({ store }) => Effect.succeed(store))

    const _provided: Effect.Effect<unknown, unknown, OtelTracer.OtelTracer> = prog.pipe(Effect.provide(storeLayer))
    // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- regression test (issue #1103) asserts only the R channel; the success/error channels are intentionally widened to `unknown` to stay decoupled from exact types
    void _provided
  })

  it('fromDeferred layer output satisfies the same R channel', () => {
    const prog = MainStore

    /** fromDeferred + DeferredLayer should satisfy MainStore in R */
    const _provided = prog.pipe(Effect.provide(Layer.merge(MainStore.fromDeferred, MainStore.DeferredLayer)))

    type _R = Effect.Services<typeof _provided>
    /** MainStore should not be in R after providing fromDeferred */
    type _MainStoreNotInR = StoreTagClass<typeof schema, 'main'> extends _R ? false : true
    const _check: _MainStoreNotInR = true
    void _check
  })
})
