import { makeAdapter } from '@livestore/adapter-node'
import { makeSchema, State } from '@livestore/common/schema'
import { createStore, SessionIdSymbol } from '@livestore/livestore'
import { IS_CI } from '@livestore/utils'
import { Effect, FetchHttpClient, Logger, LogLevel, Schema } from '@livestore/utils/effect'
import { OtelLiveDummy, PlatformNode } from '@livestore/utils/node'
import { OtelLiveHttp } from '@livestore/utils-dev/node'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import { expect } from 'vitest'

Vitest.describe('issue #487 - Optional fields without defaults cause errors', () => {
  Vitest.scopedLive('reproduces livestore-optional-field-bug repo scenario', (test) =>
    Effect.gen(function* () {
      // Exact setup from https://github.com/rubywwwilde/livestore-optional-field-bug
      const uiState = State.SQLite.clientDocument({
        name: 'UiState',
        schema: Schema.Struct({
          newTodoText: Schema.String,
          description: Schema.optional(Schema.String), // Optional field
          filter: Schema.Literal('all', 'active', 'completed'),
        }),
        default: {
          id: SessionIdSymbol,
          value: {
            newTodoText: '',
            filter: 'all',
            // No default for description - this is the issue
          },
        },
      })

      const tables = { uiState }
      const state = State.SQLite.makeState({ tables, materializers: {} })
      const schema = makeSchema({ state, events: { UiStateSet: uiState.set } })

      // Create store with in-memory adapter
      const adapter = makeAdapter({ storage: { type: 'in-memory' } })
      const store = yield* createStore({
        schema,
        adapter,
        storeId: 'test',
      })

      // This is what the user does:
      // 1. Set a value including the optional field
      store.commit(
        uiState.set({
          newTodoText: '',
          description: 'First attempt', // Setting the optional field
          filter: 'all',
        }),
      )

      // 2. Query the value back - this should work but may fail without the fix
      const result = store.query(uiState.get())

      // User expects this to work:
      expect(result).toBeDefined()
      expect(result.newTodoText).toBe('')
      expect(result.description).toBe('First attempt')
      expect(result.filter).toBe('all')
    }).pipe(withCtx(test)),
  )
})

const otelLayer = IS_CI ? OtelLiveDummy : OtelLiveHttp({ serviceName: 'store-test', skipLogUrl: false })

const withCtx =
  (testContext: Vitest.TaskContext, { suffix }: { suffix?: string; skipOtel?: boolean } = {}) =>
  <A, E, R>(self: Effect.Effect<A, E, R>) =>
    self.pipe(
      Effect.timeout(IS_CI ? 60_000 : 10_000),
      Effect.provide(FetchHttpClient.layer),
      Effect.provide(PlatformNode.NodeFileSystem.layer),
      Logger.withMinimumLogLevel(LogLevel.Debug),
      Effect.provide(Logger.prettyWithThread('test-main-thread')),
      Effect.scoped,
      Effect.withSpan(`${testContext.task.suite?.name}:${testContext.task.name}${suffix ? `:${suffix}` : ''}`),
      Effect.provide(otelLayer),
    )
