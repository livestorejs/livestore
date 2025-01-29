import * as LiveStore from '@livestore/livestore'
import { getSimplifiedRootSpan } from '@livestore/livestore/internal/testing-utils'
import { Effect, ReadonlyRecord, Schema } from '@livestore/utils/effect'
import * as otel from '@opentelemetry/api'
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { render, renderHook } from '@testing-library/react'
import React from 'react'
import { describe, expect, it } from 'vitest'

import { AppComponentSchema, AppRouterSchema, makeTodoMvcReact, tables, todos } from './__tests__/fixture.js'
import * as LiveStoreReact from './mod.js'

// const strictMode = process.env.REACT_STRICT_MODE !== undefined

// NOTE running tests concurrently doesn't work with the default global db graph
describe('useRow', () => {
  it('should update the data based on component key', () =>
    Effect.gen(function* () {
      const { wrapper, store, reactivityGraph, makeRenderCount } = yield* makeTodoMvcReact({
        useGlobalReactivityGraph: false,
      })

      const renderCount = makeRenderCount()

      const { result, rerender } = renderHook(
        (userId: string) => {
          renderCount.inc()

          const [state, setState] = LiveStoreReact.useRow(AppComponentSchema, userId, { reactivityGraph })
          return { state, setState }
        },
        { wrapper, initialProps: 'u1' },
      )

      expect(result.current.state.id).toBe('u1')
      expect(result.current.state.username).toBe('')
      expect(renderCount.val).toBe(1)

      React.act(() =>
        store.mutate(
          LiveStore.rawSqlMutation({
            sql: LiveStore.sql`INSERT INTO UserInfo (id, username) VALUES ('u2', 'username_u2')`,
          }),
        ),
      )

      rerender('u2')

      expect(result.current.state.id).toBe('u2')
      expect(result.current.state.username).toBe('username_u2')
      expect(renderCount.val).toBe(2)
    }).pipe(Effect.scoped, Effect.tapCauseLogPretty, Effect.runPromise))

  // TODO add a test that makes sure React doesn't re-render when a setter is used to set the same value

  it('should update the data reactively - via setState', () =>
    Effect.gen(function* () {
      const { wrapper, reactivityGraph, makeRenderCount } = yield* makeTodoMvcReact({
        useGlobalReactivityGraph: false,
      })

      const renderCount = makeRenderCount()

      const { result } = renderHook(
        (userId: string) => {
          renderCount.inc()

          const [state, setState] = LiveStoreReact.useRow(AppComponentSchema, userId, { reactivityGraph })
          return { state, setState }
        },
        { wrapper, initialProps: 'u1' },
      )

      expect(result.current.state.id).toBe('u1')
      expect(result.current.state.username).toBe('')
      expect(renderCount.val).toBe(1)

      React.act(() => result.current.setState.username('username_u1_hello'))

      expect(result.current.state.id).toBe('u1')
      expect(result.current.state.username).toBe('username_u1_hello')
      expect(renderCount.val).toBe(2)
    }).pipe(Effect.scoped, Effect.tapCauseLogPretty, Effect.runPromise))

  it('should update the data reactively - via raw store mutation', () =>
    Effect.gen(function* () {
      const { wrapper, store, reactivityGraph, makeRenderCount } = yield* makeTodoMvcReact({
        useGlobalReactivityGraph: false,
      })

      const renderCount = makeRenderCount()

      const { result } = renderHook(
        (userId: string) => {
          renderCount.inc()

          const [state, setState] = LiveStoreReact.useRow(AppComponentSchema, userId, { reactivityGraph })
          return { state, setState }
        },
        { wrapper, initialProps: 'u1' },
      )

      expect(result.current.state.id).toBe('u1')
      expect(result.current.state.username).toBe('')
      expect(renderCount.val).toBe(1)

      React.act(() =>
        store.mutate(
          LiveStore.rawSqlMutation({
            sql: LiveStore.sql`UPDATE UserInfo SET username = 'username_u1_hello' WHERE id = 'u1';`,
          }),
        ),
      )

      expect(result.current.state.id).toBe('u1')
      expect(result.current.state.username).toBe('username_u1_hello')
      expect(renderCount.val).toBe(2)
    }).pipe(Effect.scoped, Effect.tapCauseLogPretty, Effect.runPromise))

  it('should work for a larger app', () =>
    Effect.gen(function* () {
      const { wrapper, store, reactivityGraph, makeRenderCount } = yield* makeTodoMvcReact({
        useGlobalReactivityGraph: false,
      })

      const allTodos$ = LiveStore.queryDb(
        { query: `select * from todos`, schema: Schema.Array(tables.todos.schema) },
        { label: 'allTodos', reactivityGraph },
      )

      const appRouterRenderCount = makeRenderCount()
      let globalSetState: LiveStoreReact.StateSetters<typeof AppRouterSchema> | undefined
      const AppRouter: React.FC = () => {
        appRouterRenderCount.inc()

        const [state, setState] = LiveStoreReact.useRow(AppRouterSchema, { reactivityGraph })

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
        const [todo] = LiveStoreReact.useRow(todos, id, { reactivityGraph })
        return <div role="content">{JSON.stringify(todo)}</div>
      }

      const renderResult = render(<AppRouter />, { wrapper })

      expect(appRouterRenderCount.val).toBe(1)

      React.act(() =>
        store.mutate(
          LiveStore.rawSqlMutation({
            sql: LiveStore.sql`INSERT INTO todos (id, text, completed) VALUES ('t1', 'buy milk', 0)`,
          }),
        ),
      )

      expect(appRouterRenderCount.val).toBe(1)
      expect(renderResult.getByRole('current-id').innerHTML).toMatchInlineSnapshot('"Current Task Id: -"')

      React.act(() => globalSetState!.currentTaskId('t1'))

      expect(appRouterRenderCount.val).toBe(2)
      expect(renderResult.getByRole('content').innerHTML).toMatchInlineSnapshot(
        `"{"id":"t1","text":"buy milk","completed":false}"`,
      )

      expect(renderResult.getByRole('current-id').innerHTML).toMatchInlineSnapshot('"Current Task Id: t1"')

      React.act(() =>
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

      expect(appRouterRenderCount.val).toBe(3)
      expect(renderResult.getByRole('current-id').innerHTML).toMatchInlineSnapshot('"Current Task Id: t2"')
    }).pipe(Effect.scoped, Effect.tapCauseLogPretty, Effect.runPromise))

  it('should work for a useRow query chained with a useTemporary query', () =>
    Effect.gen(function* () {
      const { store, wrapper, reactivityGraph, makeRenderCount } = yield* makeTodoMvcReact({
        useGlobalReactivityGraph: false,
      })
      const renderCount = makeRenderCount()

      store.mutate(
        todos.insert({ id: 't1', text: 'buy milk', completed: false }),
        todos.insert({ id: 't2', text: 'buy bread', completed: false }),
      )

      const { result, unmount, rerender } = renderHook(
        (userId: string) => {
          renderCount.inc()

          const [_row, _setRow, rowState$] = LiveStoreReact.useRow(AppComponentSchema, userId, { reactivityGraph })
          const todos = LiveStoreReact.useScopedQuery(
            () =>
              LiveStore.queryDb(
                (get) => ({
                  query: LiveStore.sql`select * from todos where text like '%${get(rowState$).text}%'`,
                  schema: Schema.Array(tables.todos.schema),
                }),
                { reactivityGraph, label: 'todosFiltered' },
              ),
            userId,
          )

          return { todos }
        },
        { wrapper, initialProps: 'u1' },
      )

      React.act(() =>
        store.mutate(
          LiveStore.rawSqlMutation({
            sql: LiveStore.sql`INSERT INTO UserInfo (id, username, text) VALUES ('u2', 'username_u2', 'milk')`,
          }),
        ),
      )

      expect(result.current.todos.length).toBe(2)
      // expect(result.current.state.username).toBe('')
      expect(renderCount.val).toBe(1)

      rerender('u2')

      expect(result.current.todos.length).toBe(1)
      expect(renderCount.val).toBe(2)

      unmount()
    }).pipe(Effect.scoped, Effect.tapCauseLogPretty, Effect.runPromise))

  describe('otel', () => {
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
          const { wrapper, store, reactivityGraph, makeRenderCount } = yield* makeTodoMvcReact({
            useGlobalReactivityGraph: false,
            otelContext,
            otelTracer,
            strictMode,
          })

          const renderCount = makeRenderCount()

          const { result, rerender, unmount } = renderHook(
            (userId: string) => {
              renderCount.inc()

              const [state, setState] = LiveStoreReact.useRow(AppComponentSchema, userId, { reactivityGraph })
              return { state, setState }
            },
            { wrapper, initialProps: 'u1' },
          )

          expect(result.current.state.id).toBe('u1')
          expect(result.current.state.username).toBe('')
          expect(renderCount.val).toBe(1)

          React.act(() =>
            store.mutate(
              LiveStore.rawSqlMutation({
                sql: LiveStore.sql`INSERT INTO UserInfo (id, username) VALUES ('u2', 'username_u2')`,
              }),
            ),
          )

          rerender('u2')

          expect(result.current.state.id).toBe('u2')
          expect(result.current.state.username).toBe('username_u2')
          expect(renderCount.val).toBe(2)

          unmount()
          span.end()

          return { strictMode }
        }).pipe(Effect.scoped, Effect.tapCauseLogPretty, Effect.runPromise)

        const mapAttributes = (attributes: otel.Attributes) => {
          return ReadonlyRecord.map(attributes, (val, key) => {
            if (key === 'stackInfo') {
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
