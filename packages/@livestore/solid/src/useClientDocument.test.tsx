/** biome-ignore-all lint/a11y/useValidAriaRole: not needed for testing */
/** biome-ignore-all lint/a11y/noStaticElementInteractions: not needed for testing */
import * as LiveStore from '@livestore/livestore'
import { getAllSimplifiedRootSpans, getSimplifiedRootSpan } from '@livestore/livestore/internal/testing-utils'
import { Effect, ReadonlyRecord, Schema } from '@livestore/utils/effect'
import { Vitest } from '@livestore/utils-dev/node-vitest'
import * as otel from '@opentelemetry/api'
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import * as SolidTesting from '@solidjs/testing-library'
import { beforeEach, expect, it } from 'vitest'

import { events, makeTodoMvcSolid, tables } from './__tests__/fixture.js'
import type * as LiveStoreSolid from './mod.js'
import { __resetUseRcResourceCache } from './useRcResource.js'
import { createSignal, For } from 'solid-js'

// const strictMode = process.env.REACT_STRICT_MODE !== undefined

// NOTE running tests concurrently doesn't work with the default global db graph
Vitest.describe('useClientDocument', () => {
  beforeEach(() => {
    __resetUseRcResourceCache()
  })

  Vitest.scopedLive('should update the data based on component key', () =>
    Effect.gen(function* () {
      const { wrapper, store } = yield* makeTodoMvcSolid({})

      const [userId, setUserId] = createSignal('u1')

      const { result } = SolidTesting.renderHook(
        () => {
          const [state, setState, id] = store.useClientDocument(() => tables.userInfo, userId)
          return { state, setState, id }
        },
        { wrapper },
      )

      expect(result.id()).toBe('u1')
      expect(result.state().username).toBe('')
      expect(store.reactivityGraph.getSnapshot({ includeResults: true })).toMatchSnapshot()
      store.commit(tables.userInfo.set({ username: 'username_u2' }, 'u2'))

      setUserId('u2')

      expect(store.reactivityGraph.getSnapshot({ includeResults: true })).toMatchSnapshot()
      expect(result.id()).toBe('u2')
      expect(result.state().username).toBe('username_u2')
    }),
  )

  // TODO add a test that makes sure Solid doesn't re-render when a setter is used to set the same value

  Vitest.scopedLive('should update the data reactively - via setState', () =>
    Effect.gen(function* () {
      const { wrapper, store } = yield* makeTodoMvcSolid({})

      const { result } = SolidTesting.renderHook(
        () => {
          const [state, setState, id] = store.useClientDocument(
            () => tables.userInfo,
            () => 'u1',
          )
          return { state, setState, id }
        },
        { wrapper },
      )

      expect(result.id()).toBe('u1')
      expect(result.state().username).toBe('')

      result.setState({ username: 'username_u1_hello' })

      expect(result.id()).toBe('u1')
      expect(result.state().username).toBe('username_u1_hello')
    }),
  )

  Vitest.scopedLive('should update the data reactively - via raw store commit', () =>
    Effect.gen(function* () {
      const { wrapper, store } = yield* makeTodoMvcSolid({})

      const { result } = SolidTesting.renderHook(
        () => {
          const [state, setState, id] = store.useClientDocument(
            () => tables.userInfo,
            () => 'u1',
          )
          return { state, setState, id }
        },
        { wrapper },
      )

      expect(result.id()).toBe('u1')
      expect(result.state().username).toBe('')

      store.commit(events.UserInfoSet({ username: 'username_u1_hello' }, 'u1'))

      expect(result.id()).toBe('u1')
      expect(result.state().username).toBe('username_u1_hello')
    }),
  )

  Vitest.scopedLive('should work for a larger app', () =>
    Effect.gen(function* () {
      const { wrapper, store } = yield* makeTodoMvcSolid({})

      const allTodos$ = LiveStore.queryDb(
        { query: `select * from todos`, schema: Schema.Array(tables.todos.rowSchema) },
        { label: 'allTodos' },
      )

      let globalSetState: LiveStoreSolid.StateSetters<typeof tables.AppRouterSchema> | undefined
      const AppRouter = () => {
        const [state, setState] = store.useClientDocument(
          () => tables.AppRouterSchema,
          () => 'singleton',
        )

        globalSetState = setState

        return (
          <div>
            <TasksList setTaskId={(taskId) => setState({ currentTaskId: taskId })} />
            <div role="current-id">Current Task Id: {state().currentTaskId ?? '-'}</div>
            {state().currentTaskId ? (
              <TaskDetails id={state().currentTaskId} />
            ) : (
              <div>Click on a task to see details</div>
            )}
          </div>
        )
      }

      const TasksList = (props: { setTaskId: (_: string) => void }) => {
        const allTodos = store.useQuery(() => allTodos$)

        return (
          <div>
            <For each={allTodos()}>{(todo) => <div onClick={() => props.setTaskId(todo.id)}>{todo.id}</div>}</For>
          </div>
        )
      }

      const TaskDetails = (props: { id: string }) => {
        const todo = store.useQuery(() =>
          LiveStore.queryDb(tables.todos.where({ id: props.id }).first(), { deps: props.id }),
        )

        return <div role="content">{JSON.stringify(todo())}</div>
      }

      const { getByRole } = SolidTesting.render(() => <AppRouter />, { wrapper })

      store.commit(events.todoCreated({ id: 't1', text: 'buy milk', completed: false }))

      expect(getByRole('current-id').innerHTML).toMatchInlineSnapshot('"Current Task Id: -"')

      globalSetState!({ currentTaskId: 't1' })

      expect(getByRole('content').innerHTML).toMatchInlineSnapshot(`"{"id":"t1","text":"buy milk","completed":false}"`)

      expect(getByRole('current-id').innerHTML).toMatchInlineSnapshot('"Current Task Id: t1"')

      store.commit(
        events.todoCreated({ id: 't2', text: 'buy eggs', completed: false }),
        events.AppRouterSet({ currentTaskId: 't2' }),
        events.todoCreated({ id: 't3', text: 'buy bread', completed: false }),
      )

      expect(getByRole('current-id').innerHTML).toMatchInlineSnapshot('"Current Task Id: t2"')
    }),
  )

  Vitest.scopedLive('should work for a useClientDocument query chained with a useTemporary query', () =>
    Effect.gen(function* () {
      const { store, wrapper } = yield* makeTodoMvcSolid({})

      store.commit(
        events.todoCreated({ id: 't1', text: 'buy milk', completed: false }),
        events.todoCreated({ id: 't2', text: 'buy bread', completed: false }),
      )

      const [userId, setUserId] = createSignal('u1')

      const { result } = SolidTesting.renderHook(
        () => {
          const [_row, _setRow, _id, rowState$] = store.useClientDocument(() => tables.userInfo, userId)
          const todos = store.useQuery(
            () =>
              LiveStore.queryDb(
                (get) => tables.todos.where('text', 'LIKE', `%${get(rowState$()).text}%`),
                // TODO find a way where explicit `userId` is not needed here
                // possibly by automatically understanding the `get(rowState$)` dependency
                { label: 'todosFiltered', deps: userId() },
              ),
            // TODO introduce a `deps` array which is only needed when a query is parametric
          )

          return { todos }
        },
        { wrapper },
      )

      expect(result.todos().length).toBe(2)

      // Set text filter for u2 and test with second user
      store.commit(events.UserInfoSet({ username: 'username_u2', text: 'milk' }, 'u2'))

      setUserId('u2')

      expect(result.todos().length).toBe(1)
    }),
  )

  Vitest.scopedLive('kv client document overwrites value (Schema.Any, no partial merge)', () =>
    Effect.gen(function* () {
      const { wrapper, store } = yield* makeTodoMvcSolid({})

      const { result } = SolidTesting.renderHook(
        () => {
          const [state, setState] = store.useClientDocument(
            () => tables.kv,
            () => 'k1',
          )
          return { state, setState, id: () => 'k1' }
        },
        { wrapper },
      )

      expect(result.id()).toBe('k1')
      expect(result.state()).toBe(null)

      result.setState(1)
      expect(result.state()).toEqual(1)

      result.setState({ b: 2 })
      expect(result.state()).toEqual({ b: 2 })
    }),
  )

  Vitest.describe('otel', () => {
    it('should update the data based on component key', async () => {
      const exporter = new InMemorySpanExporter()

      const provider = new BasicTracerProvider({
        spanProcessors: [new SimpleSpanProcessor(exporter)],
      })

      const otelTracer = provider.getTracer(`testing-solid`)

      const span = otelTracer.startSpan('test-root')
      const otelContext = otel.trace.setSpan(otel.context.active(), span)

      await Effect.gen(function* () {
        const { wrapper, store } = yield* makeTodoMvcSolid({
          otelContext,
          otelTracer,
        })

        // Test with first user
        const { result: result1 } = SolidTesting.renderHook(
          () => {
            const [state, setState, id] = store.useClientDocument(
              () => tables.userInfo,
              () => 'u1',
            )
            return { state, setState, id }
          },
          { wrapper },
        )

        expect(result1.id()).toBe('u1')
        expect(result1.state().username).toBe('')

        // For u2 we'll make sure that the row already exists,
        // so the lazy `insert` will be skipped
        store.commit(events.UserInfoSet({ username: 'username_u2' }, 'u2'))

        // Test with second user (new hook instance)
        const { result: result2 } = SolidTesting.renderHook(
          () => {
            const [state, setState, id] = store.useClientDocument(
              () => tables.userInfo,
              () => 'u2',
            )
            return { state, setState, id }
          },
          { wrapper },
        )

        expect(result2.id()).toBe('u2')
        expect(result2.state().username).toBe('username_u2')

        // Note: Solid testing library cleanup happens automatically
        span.end()
      }).pipe(Effect.scoped, Effect.tapCauseLogPretty, Effect.runPromise)

      await provider.forceFlush()

      const mapAttributes = (attributes: otel.Attributes) => {
        return ReadonlyRecord.map(attributes, (val, key) => {
          if (key === 'code.stacktrace') {
            return '<STACKTRACE>'
          } else if (key === 'firstStackInfo') {
            const stackInfo = JSON.parse(val as string) as LiveStore.StackInfo
            // stackInfo.frames.shift() // Removes `renderHook.wrapper` from the stack
            stackInfo.frames.forEach((_) => {
              if (_.name.includes('renderHook.wrapper')) {
                _.name = 'renderHook.wrapper'
              }
              _.filePath = '__REPLACED_FOR_SNAPSHOT__'
            })
            return JSON.stringify(stackInfo)
          }
          return val
        })
      }

      expect(getSimplifiedRootSpan(exporter, 'createStore', mapAttributes)).toMatchSnapshot()
      expect(getAllSimplifiedRootSpans(exporter, 'LiveStore:commit', mapAttributes)).toMatchSnapshot()

      await provider.shutdown()
    })
  })
})
