import type { Scope } from '@livestore/utils/effect'
import { Context, Deferred, Duration, Effect, Layer, OtelTracer, pipe, Runtime } from '@livestore/utils/effect'
import * as otel from '@opentelemetry/api'
import type { GraphQLSchema } from 'graphql'

// import initSqlite3Wasm from 'sqlite-esm'
import type { InMemoryDatabase } from '../inMemoryDatabase.js'
import type { LiveStoreSchema } from '../schema/index.js'
import type { StorageInit } from '../storage/index.js'
import type { BaseGraphQLContext, GraphQLOptions, LiveStoreQuery, Store } from '../store.js'
import { createStore } from '../store.js'

// NOTE we're starting to initialize the sqlite wasm binary here (already before calling `createStore`),
// so that it's ready when we need it
// const sqlite3Promise = initSqlite3Wasm({
//   print: (message) => console.log(`[livestore sqlite] ${message}`),
//   printErr: (message) => console.error(`[livestore sqlite] ${message}`),
// })

// TODO get rid of `LiveStoreContext` wrapper and only expose the `Store` directly
export type LiveStoreContext = {
  store: Store
}

export type QueryDefinition = (store: Store) => LiveStoreQuery

type ExecThisOptions = any
type ExecResultRowsOptions = any

// type PreparedStatement = {
//   // db: DatabaseApi
//   // bind(value: any): PreparedStatement
//   // bind(idx: number, value: any): PreparedStatement
//   // bindAsBlob(value: any): any
//   // bindAsBlob(idx: number, value: any): any
//   // get(ndx: number, asType?: any): any

//   // finalize(): any
//   // stepFinalize(): boolean

//   // // TODO
//   // columnCount(): number
//   // parameterCount(): number
//   // clearBindings(): any
//   reset(): any
//   step(): any
//   // stepReset(): any
//   // getInt(c: number): number
//   // getFloat(c: number): number
//   // getString(c: number): string
//   // getBlob(c: number): Uint8Array
//   // getJSON: any
//   // getColumnName(c: number): string
//   getColumnNames(): string[]
//   // getParamIndex: any
//   // pointer: number
// }

export type SQLiteBindValue = string | number | null | boolean | Uint8Array
export type SQLiteBindParams = Record<string, SQLiteBindValue> | SQLiteBindValue[]
export type SQLiteVariadicBindParams = SQLiteBindValue[]

export type SQLiteBindPrimitiveParams = Record<string, Exclude<SQLiteBindValue, Uint8Array>>
export type SQLiteBindBlobParams = Record<string, Uint8Array>
export type SQLiteColumnNames = string[]
export type SQLiteColumnValues = any[]
export type SQLiteAnyDatabase = any

export interface SQLiteExecuteSyncResult<T> extends IterableIterator<T> {
  /**
   * The last inserted row ID. Returned from the [`sqlite3_last_insert_rowid()`](https://www.sqlite.org/c3ref/last_insert_rowid.html) function.
   */
  readonly lastInsertRowId: number

  /**
   * The number of rows affected. Returned from the [`sqlite3_changes()`](https://www.sqlite.org/c3ref/changes.html) function.
   */
  readonly changes: number

  /**
   * Get the first row of the result set. This requires the SQLite cursor to be in its initial state. If you have already retrieved rows from the result set, you need to reset the cursor first by calling [`resetSync()`](#resetsync). Otherwise, an error will be thrown.
   */
  getFirstSync(): T | null

  /**
   * Get all rows of the result set. This requires the SQLite cursor to be in its initial state. If you have already retrieved rows from the result set, you need to reset the cursor first by calling [`resetSync()`](#resetsync). Otherwise, an error will be thrown.
   */
  getAllSync(): T[]

  /**
   * Reset the prepared statement cursor. This will call the [`sqlite3_reset()`](https://www.sqlite.org/c3ref/reset.html) C function under the hood.
   */
  resetSync(): void
}

type ValuesOf<T extends object> = T[keyof T][]

export interface PreparedStatement {
  /**
   * Run the prepared statement and return the [`SQLiteExecuteSyncResult`](#sqliteexecutesyncresult) instance.
   * > **Note:** Running heavy tasks with this function can block the JavaScript thread and affect performance.
   * @param params The parameters to bind to the prepared statement. You can pass values in array, object, or variadic arguments. See [`SQLiteBindValue`](#sqlitebindvalue) for more information about binding values.
   */
  executeSync<T>(params: SQLiteBindParams): SQLiteExecuteSyncResult<T>
  /**
   * @hidden
   */
  executeSync<T>(...params: SQLiteVariadicBindParams): SQLiteExecuteSyncResult<T>
  /**
   * Similar to [`executeSync()`](#executesyncparams) but returns the raw value array result instead of the row objects.
   * @hidden Advanced use only.
   */
  executeForRawResultSync<T extends object>(params: SQLiteBindParams): SQLiteExecuteSyncResult<ValuesOf<T>>
  /**
   * @hidden
   */
  executeForRawResultSync<T extends object>(...params: SQLiteVariadicBindParams): SQLiteExecuteSyncResult<ValuesOf<T>>
  /**
   * Get the column names of the prepared statement.
   */
  getColumnNamesSync(): string[]
  /**
   * Finalize the prepared statement. This will call the [`sqlite3_finalize()`](https://www.sqlite.org/c3ref/finalize.html) C function under the hood.
   *
   * Attempting to access a finalized statement will result in an error.
   * > **Note:** While expo-sqlite will automatically finalize any orphaned prepared statements upon closing the database, it is considered best practice to manually finalize prepared statements as soon as they are no longer needed. This helps to prevent resource leaks. You can use the `try...finally` statement to ensure that prepared statements are finalized even if an error occurs.
   */
  finalizeSync(): void
}

export type DatabaseApi = {
  filename: string
  pointer: number
  exec(input: string, opts?: ExecThisOptions): DatabaseApi
  exec(input: string, opts?: ExecResultRowsOptions): any

  exec(opts: ExecThisOptions): DatabaseApi
  exec(opts: ExecResultRowsOptions): any

  // exec(opts: ExecOptions & {returnValue: "resultRows"}): any;
  prepare(sql: string): PreparedStatement

  isOpen: () => boolean
  affirmOpen: () => DatabaseApi
  close: () => void
  changes: (total?: boolean, sixtyFour?: boolean) => number
  dbFilename: () => string
  dbName: () => string
  dbVfsName: (dbName: any) => string
  createFunction: Function

  selectValue: Function
  selectValues: Function
  selectArray: Function
  selectObject: Function
  selectArrays: Function
  selectObjects: Function

  openStatementCount: Function
  transaction: Function
  savepoint: Function
  checkRc: Function
}

export type LiveStoreCreateStoreOptions<GraphQLContext extends BaseGraphQLContext> = {
  schema: LiveStoreSchema
  loadStorage: () => StorageInit | Promise<StorageInit>
  graphQLOptions?: GraphQLOptions<GraphQLContext>
  otelTracer?: otel.Tracer
  otelRootSpanContext?: otel.Context
  boot?: (db: InMemoryDatabase, parentSpan: otel.Span) => unknown | Promise<unknown>
  sqlite3: DatabaseApi
}

export const LiveStoreContext = Context.Tag<LiveStoreContext>('@livestore/livestore/LiveStoreContext')

export type DeferredStoreContext = Deferred.Deferred<never, LiveStoreContext>
export const DeferredStoreContext = Context.Tag<DeferredStoreContext>(
  Symbol.for('@livestore/livestore/DeferredStoreContext'),
)

// export const DeferredStoreContext = Effect.cached(Effect.flatMap(StoreContext, (_) => Effect.succeed(_)))

export type LiveStoreContextProps<GraphQLContext extends BaseGraphQLContext> = {
  schema: LiveStoreSchema
  loadStorage: () => StorageInit | Promise<StorageInit>
  graphQLOptions?: {
    schema: Effect.Effect<otel.Tracer, never, GraphQLSchema>
    makeContext: (db: InMemoryDatabase) => GraphQLContext
  }
  boot?: (db: InMemoryDatabase) => Effect.Effect<never, never, void>
}

export const LiveStoreContextLayer = <GraphQLContext extends BaseGraphQLContext>(
  props: LiveStoreContextProps<GraphQLContext>,
): Layer.Layer<otel.Tracer, never, LiveStoreContext> =>
  Layer.scoped(LiveStoreContext, makeLiveStoreContext(props)).pipe(
    Layer.withSpan('LiveStore'),
    Layer.provide(LiveStoreContextDeferred),
  )

export const LiveStoreContextDeferred = Layer.effect(DeferredStoreContext, Deferred.make<never, LiveStoreContext>())

export const makeLiveStoreContext = <GraphQLContext extends BaseGraphQLContext>({
  schema,
  loadStorage,
  graphQLOptions: graphQLOptions_,
  boot: boot_,
}: LiveStoreContextProps<GraphQLContext>): Effect.Effect<
  DeferredStoreContext | Scope.Scope | otel.Tracer,
  never,
  LiveStoreContext
> =>
  pipe(
    Effect.gen(function* ($) {
      const runtime = yield* $(Effect.runtime<never>())

      const otelRootSpanContext = otel.context.active()

      const otelTracer = yield* $(OtelTracer.Tracer)

      const graphQLOptions = yield* $(
        graphQLOptions_
          ? Effect.all({ schema: graphQLOptions_.schema, makeContext: Effect.succeed(graphQLOptions_.makeContext) })
          : Effect.succeed(undefined),
      )

      const boot = boot_
        ? (db: InMemoryDatabase) =>
            boot_(db).pipe(Effect.withSpan('boot'), Effect.tapCauseLogPretty, Runtime.runPromise(runtime))
        : undefined

      // @ts-expect-error
      const sqlite3 = yield* $(Effect.promise(() => sqlite3Promise))

      const store = yield* $(
        Effect.tryPromise(() =>
          createStore({
            schema,
            loadStorage,
            graphQLOptions,
            otelTracer,
            otelRootSpanContext,
            boot,
            // @ts-expect-error
            sqlite3,
          }),
        ),
        Effect.acquireRelease((store) => Effect.sync(() => store.destroy())),
      )

      window.__debugLiveStore = store

      return { store }
    }),
    Effect.tap((storeCtx) => Effect.flatMap(DeferredStoreContext, (def) => Deferred.succeed(def, storeCtx))),
    Effect.timeoutFail({
      onTimeout: () => new Error('Timed out while creating LiveStore store after 10sec'),
      duration: Duration.seconds(10),
    }),
    Effect.orDie,
  )
