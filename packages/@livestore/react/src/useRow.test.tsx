import * as LiveStore from '@livestore/livestore'
import { getSimplifiedRootSpan } from '@livestore/livestore/internal/testing-utils'
import { Effect, ReadonlyRecord, Schema } from '@livestore/utils/effect'
import { Vitest } from '@livestore/utils/node-vitest'
import * as otel from '@opentelemetry/api'
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import * as ReactTesting from '@testing-library/react'
import React from 'react'
import { beforeEach, expect, it } from 'vitest'

import { AppRouterSchema, makeTodoMvcReact, tables, todos } from './__tests__/fixture.js'
import * as LiveStoreReact from './mod.js'
import { __resetUseRcResourceCache } from './useRcResource.js'

// const strictMode = process.env.REACT_STRICT_MODE !== undefined

// NOTE running tests concurrently doesn't work with the default global db graph
Vitest.describe('useRow', () => {
  beforeEach(() => {
    __resetUseRcResourceCache()
  })

  Vitest.scopedLive('should update the data based on component key', () =>
    Effect.gen(function* () {
      const { wrapper, store, renderCount } = yield* makeTodoMvcReact({})

      const { result, rerender } = ReactTesting.renderHook(
        (userId: string) => {
          renderCount.inc()

          const [state, setState] = LiveStoreReact.useRow(tables.userInfo, userId)
          return { state, setState }
        },
        { wrapper, initialProps: 'u1' },
      )

      expect(result.current.state.id).toBe('u1')
      expect(result.current.state.username).toBe('')
      expect(renderCount.val).toBe(1)
      expect(store.reactivityGraph.getSnapshot({ includeResults: true })).toMatchSnapshot()
      store.mutate(tables.userInfo.insert({ id: 'u2', username: 'username_u2' }))

      rerender('u2')

      expect(store.reactivityGraph.getSnapshot({ includeResults: true })).toMatchSnapshot()
      expect(result.current.state.id).toBe('u2')
      expect(result.current.state.username).toBe('username_u2')
      expect(renderCount.val).toBe(2)
    }),
  )

  // TODO add a test that makes sure React doesn't re-render when a setter is used to set the same value

  Vitest.scopedLive('should update the data reactively - via setState', () =>
    Effect.gen(function* () {
      const { wrapper, renderCount } = yield* makeTodoMvcReact({})

      const { result } = ReactTesting.renderHook(
        (userId: string) => {
          renderCount.inc()

          const [state, setState] = LiveStoreReact.useRow(tables.userInfo, userId)
          return { state, setState }
        },
        { wrapper, initialProps: 'u1' },
      )

      expect(result.current.state.id).toBe('u1')
      expect(result.current.state.username).toBe('')
      expect(renderCount.val).toBe(1)

      ReactTesting.act(() => result.current.setState.username('username_u1_hello'))

      expect(result.current.state.id).toBe('u1')
      expect(result.current.state.username).toBe('username_u1_hello')
      expect(renderCount.val).toBe(2)
    }),
  )

  Vitest.scopedLive('should update the data reactively - via raw store mutation', () =>
    Effect.gen(function* () {
      const { wrapper, store, renderCount } = yield* makeTodoMvcReact({})

      const { result } = ReactTesting.renderHook(
        (userId: string) => {
          renderCount.inc()

          const [state, setState] = LiveStoreReact.useRow(tables.userInfo, userId)
          return { state, setState }
        },
        { wrapper, initialProps: 'u1' },
      )

      expect(result.current.state.id).toBe('u1')
      expect(result.current.state.username).toBe('')
      expect(renderCount.val).toBe(1)

      ReactTesting.act(() =>
        store.mutate(tables.userInfo.update({ where: { id: 'u1' }, values: { username: 'username_u1_hello' } })),
      )

      expect(result.current.state.id).toBe('u1')
      expect(result.current.state.username).toBe('username_u1_hello')
      expect(renderCount.val).toBe(2)
    }),
  )

  Vitest.scopedLive('should work for a larger app', () =>
    Effect.gen(function* () {
      const { wrapper, store, renderCount } = yield* makeTodoMvcReact({})

      const allTodos$ = LiveStore.queryDb(
        { query: `select * from todos`, schema: Schema.Array(tables.todos.schema) },
        { label: 'allTodos' },
      )

      let globalSetState: LiveStoreReact.StateSetters<typeof AppRouterSchema> | undefined
      const AppRouter: React.FC = () => {
        renderCount.inc()

        const [state, setState] = LiveStoreReact.useRow(AppRouterSchema)

        globalSetState = setState

        return (
          <div>
            <TasksList setTaskId={setState.currentTaskId} />
            <div role="current-id">Current Task Id: {state.currentTaskId ?? '-'}</div>
            {state.currentTaskId ? <TaskDetails id={state.currentTaskId} /> : <div>Click on a task to see details</div>}
          </div>
        )
      }

      const TasksList: React.FC<{ setTaskId: (_: string) => void }> = ({ setTaskId }) => {
        const allTodos = LiveStoreReact.useQuery(allTodos$)

        return (
          <div>
            {allTodos.map((_) => (
              <div key={_.id} onClick={() => setTaskId(_.id)}>
                {_.id}
              </div>
            ))}
          </div>
        )
      }

      const TaskDetails: React.FC<{ id: string }> = ({ id }) => {
        const [todo] = LiveStoreReact.useRow(todos, id)
        return <div role="content">{JSON.stringify(todo)}</div>
      }

      const renderResult = ReactTesting.render(<AppRouter />, { wrapper })

      expect(renderCount.val).toBe(1)

      ReactTesting.act(() =>
        store.mutate(
          LiveStore.rawSqlMutation({
            sql: LiveStore.sql`INSERT INTO todos (id, text, completed) VALUES ('t1', 'buy milk', 0)`,
          }),
        ),
      )

      expect(renderCount.val).toBe(1)
      expect(renderResult.getByRole('current-id').innerHTML).toMatchInlineSnapshot('"Current Task Id: -"')

      ReactTesting.act(() => globalSetState!.currentTaskId('t1'))

      expect(renderCount.val).toBe(2)
      expect(renderResult.getByRole('content').innerHTML).toMatchInlineSnapshot(
        `"{"id":"t1","text":"buy milk","completed":false}"`,
      )

      expect(renderResult.getByRole('current-id').innerHTML).toMatchInlineSnapshot('"Current Task Id: t1"')

      ReactTesting.act(() =>
        store.mutate(
          LiveStore.rawSqlMutation({
            sql: LiveStore.sql`INSERT INTO todos (id, text, completed) VALUES ('t2', 'buy eggs', 0)`,
          }),
          AppRouterSchema.update({ where: { id: 'singleton' }, values: { currentTaskId: 't2' } }),
          LiveStore.rawSqlMutation({
            sql: LiveStore.sql`INSERT INTO todos (id, text, completed) VALUES ('t3', 'buy bread', 0)`,
          }),
        ),
      )

      expect(renderCount.val).toBe(3)
      expect(renderResult.getByRole('current-id').innerHTML).toMatchInlineSnapshot('"Current Task Id: t2"')
    }),
  )

  Vitest.scopedLive('should work for a useRow query chained with a useTemporary query', () =>
    Effect.gen(function* () {
      const { store, wrapper, renderCount } = yield* makeTodoMvcReact({})

      store.mutate(
        todos.insert({ id: 't1', text: 'buy milk', completed: false }),
        todos.insert({ id: 't2', text: 'buy bread', completed: false }),
      )

      const { result, unmount, rerender } = ReactTesting.renderHook(
        (userId: string) => {
          renderCount.inc()

          const [_row, _setRow, rowState$] = LiveStoreReact.useRow(tables.userInfo, userId)
          const todos = LiveStoreReact.useQuery(
            LiveStore.queryDb(
              (get) => tables.todos.query.where('text', 'LIKE', `%${get(rowState$).text}%`),
              // TODO find a way where explicit `userId` is not needed here
              // possibly by automatically understanding the `get(rowState$)` dependency
              { label: 'todosFiltered', deps: userId },
            ),
            // TODO introduce a `deps` array which is only needed when a query is parametric
          )

          return { todos }
        },
        { wrapper, initialProps: 'u1' },
      )

      ReactTesting.act(() => store.mutate(tables.userInfo.insert({ id: 'u2', username: 'username_u2', text: 'milk' })))

      expect(result.current.todos.length).toBe(2)
      expect(renderCount.val).toBe(1)

      rerender('u2')

      expect(result.current.todos.length).toBe(1)
      expect(renderCount.val).toBe(2)

      unmount()
    }),
  )

  Vitest.describe('otel', () => {
    const provider = new BasicTracerProvider({})
    provider.register()

    it.each([{ strictMode: true }, { strictMode: false }])(
      'should update the data based on component key strictMode=%s',
      async ({ strictMode }) => {
        const exporter = new InMemorySpanExporter()

        // const provider = cachedProvider ?? new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] })
        provider.addSpanProcessor(new SimpleSpanProcessor(exporter))

        const otelTracer = otel.trace.getTracer(`testing-${strictMode ? 'strict' : 'non-strict'}`)

        const span = otelTracer.startSpan('test-root')
        const otelContext = otel.trace.setSpan(otel.context.active(), span)

        await Effect.gen(function* () {
          const { wrapper, store, renderCount } = yield* makeTodoMvcReact({
            otelContext,
            otelTracer,
            strictMode,
          })

          const { result, rerender, unmount } = ReactTesting.renderHook(
            (userId: string) => {
              renderCount.inc()

              const [state, setState] = LiveStoreReact.useRow(tables.userInfo, userId)
              return { state, setState }
            },
            { wrapper, initialProps: 'u1' },
          )

          expect(result.current.state.id).toBe('u1')
          expect(result.current.state.username).toBe('')
          expect(renderCount.val).toBe(1)

          // For u2 we'll make sure that the row already exists,
          // so the lazy `insert` will be skipped
          ReactTesting.act(() => store.mutate(tables.userInfo.insert({ id: 'u2', username: 'username_u2' })))

          rerender('u2')

          expect(result.current.state.id).toBe('u2')
          expect(result.current.state.username).toBe('username_u2')
          expect(renderCount.val).toBe(2)

          unmount()
          span.end()
        }).pipe(Effect.scoped, Effect.tapCauseLogPretty, Effect.runPromise)

        const mapAttributes = (attributes: otel.Attributes) => {
          return ReadonlyRecord.map(attributes, (val, key) => {
            if (key === 'firstStackInfo') {
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

        expect(getSimplifiedRootSpan(exporter, mapAttributes)).toMatchSnapshot()
      },
    )
  })
})
