
/**
 * Client
**/

import * as runtime from './runtime/index';
declare const prisma: unique symbol
export type PrismaPromise<A> = Promise<A> & {[prisma]: true}
type UnwrapPromise<P extends any> = P extends Promise<infer R> ? R : P
type UnwrapTuple<Tuple extends readonly unknown[]> = {
  [K in keyof Tuple]: K extends `${number}` ? Tuple[K] extends PrismaPromise<infer X> ? X : UnwrapPromise<Tuple[K]> : UnwrapPromise<Tuple[K]>
};


/**
 * Model Comment
 * 
 */
export type Comment = {
  id: string
  body: string
  creator: string
  issueId: string
  /**
   * @zod.custom.use(z.number().or(z.nan()))
   */
  created: number
}

/**
 * Model Description
 * 
 */
export type Description = {
  id: string
  body: string
}

/**
 * Model Issue
 * 
 */
export type Issue = {
  id: string
  title: string
  creator: string
  priority: string
  status: string
  /**
   * @zod.custom.use(z.number().or(z.nan()))
   */
  created: number
  /**
   * @zod.custom.use(z.number().or(z.nan()))
   */
  modified: number
  kanbanorder: string
}


/**
 * ##  Prisma Client ʲˢ
 * 
 * Type-safe database client for TypeScript & Node.js
 * @example
 * ```
 * const prisma = new PrismaClient()
 * // Fetch zero or more Comments
 * const comments = await prisma.comment.findMany()
 * ```
 *
 * 
 * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client).
 */
export class PrismaClient<
  T extends Prisma.PrismaClientOptions = Prisma.PrismaClientOptions,
  U = 'log' extends keyof T ? T['log'] extends Array<Prisma.LogLevel | Prisma.LogDefinition> ? Prisma.GetEvents<T['log']> : never : never,
  GlobalReject extends Prisma.RejectOnNotFound | Prisma.RejectPerOperation | false | undefined = 'rejectOnNotFound' extends keyof T
    ? T['rejectOnNotFound']
    : false
      > {
    /**
   * ##  Prisma Client ʲˢ
   * 
   * Type-safe database client for TypeScript & Node.js
   * @example
   * ```
   * const prisma = new PrismaClient()
   * // Fetch zero or more Comments
   * const comments = await prisma.comment.findMany()
   * ```
   *
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client).
   */

  constructor(optionsArg ?: Prisma.Subset<T, Prisma.PrismaClientOptions>);
  $on<V extends (U | 'beforeExit')>(eventType: V, callback: (event: V extends 'query' ? Prisma.QueryEvent : V extends 'beforeExit' ? () => Promise<void> : Prisma.LogEvent) => void): void;

  /**
   * Connect with the database
   */
  $connect(): Promise<void>;

  /**
   * Disconnect from the database
   */
  $disconnect(): Promise<void>;

  /**
   * Add a middleware
   */
  $use(cb: Prisma.Middleware): void

/**
   * Executes a prepared raw query and returns the number of affected rows.
   * @example
   * ```
   * const result = await prisma.$executeRaw`UPDATE User SET cool = ${true} WHERE email = ${'user@email.com'};`
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $executeRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): PrismaPromise<number>;

  /**
   * Executes a raw query and returns the number of affected rows.
   * Susceptible to SQL injections, see documentation.
   * @example
   * ```
   * const result = await prisma.$executeRawUnsafe('UPDATE User SET cool = $1 WHERE email = $2 ;', true, 'user@email.com')
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $executeRawUnsafe<T = unknown>(query: string, ...values: any[]): PrismaPromise<number>;

  /**
   * Performs a prepared raw query and returns the `SELECT` data.
   * @example
   * ```
   * const result = await prisma.$queryRaw`SELECT * FROM User WHERE id = ${1} OR email = ${'user@email.com'};`
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $queryRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): PrismaPromise<T>;

  /**
   * Performs a raw query and returns the `SELECT` data.
   * Susceptible to SQL injections, see documentation.
   * @example
   * ```
   * const result = await prisma.$queryRawUnsafe('SELECT * FROM User WHERE id = $1 OR email = $2;', 1, 'user@email.com')
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $queryRawUnsafe<T = unknown>(query: string, ...values: any[]): PrismaPromise<T>;

  /**
   * Allows the running of a sequence of read/write operations that are guaranteed to either succeed or fail as a whole.
   * @example
   * ```
   * const [george, bob, alice] = await prisma.$transaction([
   *   prisma.user.create({ data: { name: 'George' } }),
   *   prisma.user.create({ data: { name: 'Bob' } }),
   *   prisma.user.create({ data: { name: 'Alice' } }),
   * ])
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/concepts/components/prisma-client/transactions).
   */
  $transaction<P extends PrismaPromise<any>[]>(arg: [...P], options?: { isolationLevel?: Prisma.TransactionIsolationLevel }): Promise<UnwrapTuple<P>>;

  $transaction<R>(fn: (prisma: Prisma.TransactionClient) => Promise<R>, options?: {maxWait?: number, timeout?: number, isolationLevel?: Prisma.TransactionIsolationLevel}): Promise<R>;

      /**
   * `prisma.comment`: Exposes CRUD operations for the **Comment** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Comments
    * const comments = await prisma.comment.findMany()
    * ```
    */
  get comment(): Prisma.CommentDelegate<GlobalReject>;

  /**
   * `prisma.description`: Exposes CRUD operations for the **Description** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Descriptions
    * const descriptions = await prisma.description.findMany()
    * ```
    */
  get description(): Prisma.DescriptionDelegate<GlobalReject>;

  /**
   * `prisma.issue`: Exposes CRUD operations for the **Issue** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Issues
    * const issues = await prisma.issue.findMany()
    * ```
    */
  get issue(): Prisma.IssueDelegate<GlobalReject>;
}

export namespace Prisma {
  export import DMMF = runtime.DMMF

  /**
   * Prisma Errors
   */
  export import PrismaClientKnownRequestError = runtime.PrismaClientKnownRequestError
  export import PrismaClientUnknownRequestError = runtime.PrismaClientUnknownRequestError
  export import PrismaClientRustPanicError = runtime.PrismaClientRustPanicError
  export import PrismaClientInitializationError = runtime.PrismaClientInitializationError
  export import PrismaClientValidationError = runtime.PrismaClientValidationError
  export import NotFoundError = runtime.NotFoundError

  /**
   * Re-export of sql-template-tag
   */
  export import sql = runtime.sqltag
  export import empty = runtime.empty
  export import join = runtime.join
  export import raw = runtime.raw
  export import Sql = runtime.Sql

  /**
   * Decimal.js
   */
  export import Decimal = runtime.Decimal

  export type DecimalJsLike = runtime.DecimalJsLike

  /**
   * Metrics 
   */
  export type Metrics = runtime.Metrics
  export type Metric<T> = runtime.Metric<T>
  export type MetricHistogram = runtime.MetricHistogram
  export type MetricHistogramBucket = runtime.MetricHistogramBucket


  /**
   * Prisma Client JS version: 4.8.1
   * Query Engine version: d6e67a83f971b175a593ccc12e15c4a757f93ffe
   */
  export type PrismaVersion = {
    client: string
  }

  export const prismaVersion: PrismaVersion 

  /**
   * Utility Types
   */

  /**
   * From https://github.com/sindresorhus/type-fest/
   * Matches a JSON object.
   * This type can be useful to enforce some input to be JSON-compatible or as a super-type to be extended from. 
   */
  export type JsonObject = {[Key in string]?: JsonValue}

  /**
   * From https://github.com/sindresorhus/type-fest/
   * Matches a JSON array.
   */
  export interface JsonArray extends Array<JsonValue> {}

  /**
   * From https://github.com/sindresorhus/type-fest/
   * Matches any valid JSON value.
   */
  export type JsonValue = string | number | boolean | JsonObject | JsonArray | null

  /**
   * Matches a JSON object.
   * Unlike `JsonObject`, this type allows undefined and read-only properties.
   */
  export type InputJsonObject = {readonly [Key in string]?: InputJsonValue | null}

  /**
   * Matches a JSON array.
   * Unlike `JsonArray`, readonly arrays are assignable to this type.
   */
  export interface InputJsonArray extends ReadonlyArray<InputJsonValue | null> {}

  /**
   * Matches any valid value that can be used as an input for operations like
   * create and update as the value of a JSON field. Unlike `JsonValue`, this
   * type allows read-only arrays and read-only object properties and disallows
   * `null` at the top level.
   *
   * `null` cannot be used as the value of a JSON field because its meaning
   * would be ambiguous. Use `Prisma.JsonNull` to store the JSON null value or
   * `Prisma.DbNull` to clear the JSON value and set the field to the database
   * NULL value instead.
   *
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-by-null-values
   */
export type InputJsonValue = null | string | number | boolean | InputJsonObject | InputJsonArray

  /**
   * Types of the values used to represent different kinds of `null` values when working with JSON fields.
   * 
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  namespace NullTypes {
    /**
    * Type of `Prisma.DbNull`.
    * 
    * You cannot use other instances of this class. Please use the `Prisma.DbNull` value.
    * 
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class DbNull {
      private DbNull: never
      private constructor()
    }

    /**
    * Type of `Prisma.JsonNull`.
    * 
    * You cannot use other instances of this class. Please use the `Prisma.JsonNull` value.
    * 
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class JsonNull {
      private JsonNull: never
      private constructor()
    }

    /**
    * Type of `Prisma.AnyNull`.
    * 
    * You cannot use other instances of this class. Please use the `Prisma.AnyNull` value.
    * 
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class AnyNull {
      private AnyNull: never
      private constructor()
    }
  }

  /**
   * Helper for filtering JSON entries that have `null` on the database (empty on the db)
   * 
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const DbNull: NullTypes.DbNull

  /**
   * Helper for filtering JSON entries that have JSON `null` values (not empty on the db)
   * 
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const JsonNull: NullTypes.JsonNull

  /**
   * Helper for filtering JSON entries that are `Prisma.DbNull` or `Prisma.JsonNull`
   * 
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const AnyNull: NullTypes.AnyNull

  type SelectAndInclude = {
    select: any
    include: any
  }
  type HasSelect = {
    select: any
  }
  type HasInclude = {
    include: any
  }
  type CheckSelect<T, S, U> = T extends SelectAndInclude
    ? 'Please either choose `select` or `include`'
    : T extends HasSelect
    ? U
    : T extends HasInclude
    ? U
    : S

  /**
   * Get the type of the value, that the Promise holds.
   */
  export type PromiseType<T extends PromiseLike<any>> = T extends PromiseLike<infer U> ? U : T;

  /**
   * Get the return type of a function which returns a Promise.
   */
  export type PromiseReturnType<T extends (...args: any) => Promise<any>> = PromiseType<ReturnType<T>>

  /**
   * From T, pick a set of properties whose keys are in the union K
   */
  type Prisma__Pick<T, K extends keyof T> = {
      [P in K]: T[P];
  };


  export type Enumerable<T> = T | Array<T>;

  export type RequiredKeys<T> = {
    [K in keyof T]-?: {} extends Prisma__Pick<T, K> ? never : K
  }[keyof T]

  export type TruthyKeys<T> = keyof {
    [K in keyof T as T[K] extends false | undefined | null ? never : K]: K
  }

  export type TrueKeys<T> = TruthyKeys<Prisma__Pick<T, RequiredKeys<T>>>

  /**
   * Subset
   * @desc From `T` pick properties that exist in `U`. Simple version of Intersection
   */
  export type Subset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never;
  };

  /**
   * SelectSubset
   * @desc From `T` pick properties that exist in `U`. Simple version of Intersection.
   * Additionally, it validates, if both select and include are present. If the case, it errors.
   */
  export type SelectSubset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never
  } &
    (T extends SelectAndInclude
      ? 'Please either choose `select` or `include`.'
      : {})

  /**
   * Subset + Intersection
   * @desc From `T` pick properties that exist in `U` and intersect `K`
   */
  export type SubsetIntersection<T, U, K> = {
    [key in keyof T]: key extends keyof U ? T[key] : never
  } &
    K

  type Without<T, U> = { [P in Exclude<keyof T, keyof U>]?: never };

  /**
   * XOR is needed to have a real mutually exclusive union type
   * https://stackoverflow.com/questions/42123407/does-typescript-support-mutually-exclusive-types
   */
  type XOR<T, U> =
    T extends object ?
    U extends object ?
      (Without<T, U> & U) | (Without<U, T> & T)
    : U : T


  /**
   * Is T a Record?
   */
  type IsObject<T extends any> = T extends Array<any>
  ? False
  : T extends Date
  ? False
  : T extends Uint8Array
  ? False
  : T extends BigInt
  ? False
  : T extends object
  ? True
  : False


  /**
   * If it's T[], return T
   */
  export type UnEnumerate<T extends unknown> = T extends Array<infer U> ? U : T

  /**
   * From ts-toolbelt
   */

  type __Either<O extends object, K extends Key> = Omit<O, K> &
    {
      // Merge all but K
      [P in K]: Prisma__Pick<O, P & keyof O> // With K possibilities
    }[K]

  type EitherStrict<O extends object, K extends Key> = Strict<__Either<O, K>>

  type EitherLoose<O extends object, K extends Key> = ComputeRaw<__Either<O, K>>

  type _Either<
    O extends object,
    K extends Key,
    strict extends Boolean
  > = {
    1: EitherStrict<O, K>
    0: EitherLoose<O, K>
  }[strict]

  type Either<
    O extends object,
    K extends Key,
    strict extends Boolean = 1
  > = O extends unknown ? _Either<O, K, strict> : never

  export type Union = any

  type PatchUndefined<O extends object, O1 extends object> = {
    [K in keyof O]: O[K] extends undefined ? At<O1, K> : O[K]
  } & {}

  /** Helper Types for "Merge" **/
  export type IntersectOf<U extends Union> = (
    U extends unknown ? (k: U) => void : never
  ) extends (k: infer I) => void
    ? I
    : never

  export type Overwrite<O extends object, O1 extends object> = {
      [K in keyof O]: K extends keyof O1 ? O1[K] : O[K];
  } & {};

  type _Merge<U extends object> = IntersectOf<Overwrite<U, {
      [K in keyof U]-?: At<U, K>;
  }>>;

  type Key = string | number | symbol;
  type AtBasic<O extends object, K extends Key> = K extends keyof O ? O[K] : never;
  type AtStrict<O extends object, K extends Key> = O[K & keyof O];
  type AtLoose<O extends object, K extends Key> = O extends unknown ? AtStrict<O, K> : never;
  export type At<O extends object, K extends Key, strict extends Boolean = 1> = {
      1: AtStrict<O, K>;
      0: AtLoose<O, K>;
  }[strict];

  export type ComputeRaw<A extends any> = A extends Function ? A : {
    [K in keyof A]: A[K];
  } & {};

  export type OptionalFlat<O> = {
    [K in keyof O]?: O[K];
  } & {};

  type _Record<K extends keyof any, T> = {
    [P in K]: T;
  };

  // cause typescript not to expand types and preserve names
  type NoExpand<T> = T extends unknown ? T : never;

  // this type assumes the passed object is entirely optional
  type AtLeast<O extends object, K extends string> = NoExpand<
    O extends unknown
    ? | (K extends keyof O ? { [P in K]: O[P] } & O : O)
      | {[P in keyof O as P extends K ? K : never]-?: O[P]} & O
    : never>;

  type _Strict<U, _U = U> = U extends unknown ? U & OptionalFlat<_Record<Exclude<Keys<_U>, keyof U>, never>> : never;

  export type Strict<U extends object> = ComputeRaw<_Strict<U>>;
  /** End Helper Types for "Merge" **/

  export type Merge<U extends object> = ComputeRaw<_Merge<Strict<U>>>;

  /**
  A [[Boolean]]
  */
  export type Boolean = True | False

  // /**
  // 1
  // */
  export type True = 1

  /**
  0
  */
  export type False = 0

  export type Not<B extends Boolean> = {
    0: 1
    1: 0
  }[B]

  export type Extends<A1 extends any, A2 extends any> = [A1] extends [never]
    ? 0 // anything `never` is false
    : A1 extends A2
    ? 1
    : 0

  export type Has<U extends Union, U1 extends Union> = Not<
    Extends<Exclude<U1, U>, U1>
  >

  export type Or<B1 extends Boolean, B2 extends Boolean> = {
    0: {
      0: 0
      1: 1
    }
    1: {
      0: 1
      1: 1
    }
  }[B1][B2]

  export type Keys<U extends Union> = U extends unknown ? keyof U : never

  type Exact<A, W = unknown> = 
  W extends unknown ? A extends Narrowable ? Cast<A, W> : Cast<
  {[K in keyof A]: K extends keyof W ? Exact<A[K], W[K]> : never},
  {[K in keyof W]: K extends keyof A ? Exact<A[K], W[K]> : W[K]}>
  : never;

  type Narrowable = string | number | boolean | bigint;

  type Cast<A, B> = A extends B ? A : B;

  export const type: unique symbol;

  export function validator<V>(): <S>(select: Exact<S, V>) => S;

  /**
   * Used by group by
   */

  export type GetScalarType<T, O> = O extends object ? {
    [P in keyof T]: P extends keyof O
      ? O[P]
      : never
  } : never

  type FieldPaths<
    T,
    U = Omit<T, '_avg' | '_sum' | '_count' | '_min' | '_max'>
  > = IsObject<T> extends True ? U : T

  type GetHavingFields<T> = {
    [K in keyof T]: Or<
      Or<Extends<'OR', K>, Extends<'AND', K>>,
      Extends<'NOT', K>
    > extends True
      ? // infer is only needed to not hit TS limit
        // based on the brilliant idea of Pierre-Antoine Mills
        // https://github.com/microsoft/TypeScript/issues/30188#issuecomment-478938437
        T[K] extends infer TK
        ? GetHavingFields<UnEnumerate<TK> extends object ? Merge<UnEnumerate<TK>> : never>
        : never
      : {} extends FieldPaths<T[K]>
      ? never
      : K
  }[keyof T]

  /**
   * Convert tuple to union
   */
  type _TupleToUnion<T> = T extends (infer E)[] ? E : never
  type TupleToUnion<K extends readonly any[]> = _TupleToUnion<K>
  type MaybeTupleToUnion<T> = T extends any[] ? TupleToUnion<T> : T

  /**
   * Like `Pick`, but with an array
   */
  type PickArray<T, K extends Array<keyof T>> = Prisma__Pick<T, TupleToUnion<K>>

  /**
   * Exclude all keys with underscores
   */
  type ExcludeUnderscoreKeys<T extends string> = T extends `_${string}` ? never : T


  export type FieldRef<Model, FieldType> = runtime.FieldRef<Model, FieldType>

  type FieldRefInputType<Model, FieldType> = Model extends never ? never : FieldRef<Model, FieldType>

  class PrismaClientFetcher {
    private readonly prisma;
    private readonly debug;
    private readonly hooks?;
    constructor(prisma: PrismaClient<any, any>, debug?: boolean, hooks?: Hooks | undefined);
    request<T>(document: any, dataPath?: string[], rootField?: string, typeName?: string, isList?: boolean, callsite?: string): Promise<T>;
    sanitizeMessage(message: string): string;
    protected unpack(document: any, data: any, path: string[], rootField?: string, isList?: boolean): any;
  }

  export const ModelName: {
    Comment: 'Comment',
    Description: 'Description',
    Issue: 'Issue'
  };

  export type ModelName = (typeof ModelName)[keyof typeof ModelName]


  export type Datasources = {
    db?: Datasource
  }

  export type DefaultPrismaClient = PrismaClient
  export type RejectOnNotFound = boolean | ((error: Error) => Error)
  export type RejectPerModel = { [P in ModelName]?: RejectOnNotFound }
  export type RejectPerOperation =  { [P in "findUnique" | "findFirst"]?: RejectPerModel | RejectOnNotFound } 
  type IsReject<T> = T extends true ? True : T extends (err: Error) => Error ? True : False
  export type HasReject<
    GlobalRejectSettings extends Prisma.PrismaClientOptions['rejectOnNotFound'],
    LocalRejectSettings,
    Action extends PrismaAction,
    Model extends ModelName
  > = LocalRejectSettings extends RejectOnNotFound
    ? IsReject<LocalRejectSettings>
    : GlobalRejectSettings extends RejectPerOperation
    ? Action extends keyof GlobalRejectSettings
      ? GlobalRejectSettings[Action] extends RejectOnNotFound
        ? IsReject<GlobalRejectSettings[Action]>
        : GlobalRejectSettings[Action] extends RejectPerModel
        ? Model extends keyof GlobalRejectSettings[Action]
          ? IsReject<GlobalRejectSettings[Action][Model]>
          : False
        : False
      : False
    : IsReject<GlobalRejectSettings>
  export type ErrorFormat = 'pretty' | 'colorless' | 'minimal'

  export interface PrismaClientOptions {
    /**
     * Configure findUnique/findFirst to throw an error if the query returns null. 
     * @deprecated since 4.0.0. Use `findUniqueOrThrow`/`findFirstOrThrow` methods instead.
     * @example
     * ```
     * // Reject on both findUnique/findFirst
     * rejectOnNotFound: true
     * // Reject only on findFirst with a custom error
     * rejectOnNotFound: { findFirst: (err) => new Error("Custom Error")}
     * // Reject on user.findUnique with a custom error
     * rejectOnNotFound: { findUnique: {User: (err) => new Error("User not found")}}
     * ```
     */
    rejectOnNotFound?: RejectOnNotFound | RejectPerOperation
    /**
     * Overwrites the datasource url from your schema.prisma file
     */
    datasources?: Datasources

    /**
     * @default "colorless"
     */
    errorFormat?: ErrorFormat

    /**
     * @example
     * ```
     * // Defaults to stdout
     * log: ['query', 'info', 'warn', 'error']
     * 
     * // Emit as events
     * log: [
     *  { emit: 'stdout', level: 'query' },
     *  { emit: 'stdout', level: 'info' },
     *  { emit: 'stdout', level: 'warn' }
     *  { emit: 'stdout', level: 'error' }
     * ]
     * ```
     * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/logging#the-log-option).
     */
    log?: Array<LogLevel | LogDefinition>
  }

  export type Hooks = {
    beforeRequest?: (options: { query: string, path: string[], rootField?: string, typeName?: string, document: any }) => any
  }

  /* Types for Logging */
  export type LogLevel = 'info' | 'query' | 'warn' | 'error'
  export type LogDefinition = {
    level: LogLevel
    emit: 'stdout' | 'event'
  }

  export type GetLogType<T extends LogLevel | LogDefinition> = T extends LogDefinition ? T['emit'] extends 'event' ? T['level'] : never : never
  export type GetEvents<T extends any> = T extends Array<LogLevel | LogDefinition> ?
    GetLogType<T[0]> | GetLogType<T[1]> | GetLogType<T[2]> | GetLogType<T[3]>
    : never

  export type QueryEvent = {
    timestamp: Date
    query: string
    params: string
    duration: number
    target: string
  }

  export type LogEvent = {
    timestamp: Date
    message: string
    target: string
  }
  /* End Types for Logging */


  export type PrismaAction =
    | 'findUnique'
    | 'findMany'
    | 'findFirst'
    | 'create'
    | 'createMany'
    | 'update'
    | 'updateMany'
    | 'upsert'
    | 'delete'
    | 'deleteMany'
    | 'executeRaw'
    | 'queryRaw'
    | 'aggregate'
    | 'count'
    | 'runCommandRaw'
    | 'findRaw'

  /**
   * These options are being passed into the middleware as "params"
   */
  export type MiddlewareParams = {
    model?: ModelName
    action: PrismaAction
    args: any
    dataPath: string[]
    runInTransaction: boolean
  }

  /**
   * The `T` type makes sure, that the `return proceed` is not forgotten in the middleware implementation
   */
  export type Middleware<T = any> = (
    params: MiddlewareParams,
    next: (params: MiddlewareParams) => Promise<T>,
  ) => Promise<T>

  // tested in getLogLevel.test.ts
  export function getLogLevel(log: Array<LogLevel | LogDefinition>): LogLevel | undefined;

  /**
   * `PrismaClient` proxy available in interactive transactions.
   */
  export type TransactionClient = Omit<Prisma.DefaultPrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use'>

  export type Datasource = {
    url?: string
  }

  /**
   * Count Types
   */


  /**
   * Count Type IssueCountOutputType
   */


  export type IssueCountOutputType = {
    comment: number
  }

  export type IssueCountOutputTypeSelect = {
    comment?: boolean
  }

  export type IssueCountOutputTypeGetPayload<S extends boolean | null | undefined | IssueCountOutputTypeArgs> =
    S extends { select: any, include: any } ? 'Please either choose `select` or `include`' :
    S extends true ? IssueCountOutputType :
    S extends undefined ? never :
    S extends { include: any } & (IssueCountOutputTypeArgs)
    ? IssueCountOutputType 
    : S extends { select: any } & (IssueCountOutputTypeArgs)
      ? {
    [P in TruthyKeys<S['select']>]:
    P extends keyof IssueCountOutputType ? IssueCountOutputType[P] : never
  } 
      : IssueCountOutputType




  // Custom InputTypes

  /**
   * IssueCountOutputType without action
   */
  export type IssueCountOutputTypeArgs = {
    /**
     * Select specific fields to fetch from the IssueCountOutputType
     * 
    **/
    select?: IssueCountOutputTypeSelect | null
  }



  /**
   * Models
   */

  /**
   * Model Comment
   */


  export type AggregateComment = {
    _count: CommentCountAggregateOutputType | null
    _avg: CommentAvgAggregateOutputType | null
    _sum: CommentSumAggregateOutputType | null
    _min: CommentMinAggregateOutputType | null
    _max: CommentMaxAggregateOutputType | null
  }

  export type CommentAvgAggregateOutputType = {
    created: number | null
  }

  export type CommentSumAggregateOutputType = {
    created: number | null
  }

  export type CommentMinAggregateOutputType = {
    id: string | null
    body: string | null
    creator: string | null
    issueId: string | null
    created: number | null
  }

  export type CommentMaxAggregateOutputType = {
    id: string | null
    body: string | null
    creator: string | null
    issueId: string | null
    created: number | null
  }

  export type CommentCountAggregateOutputType = {
    id: number
    body: number
    creator: number
    issueId: number
    created: number
    _all: number
  }


  export type CommentAvgAggregateInputType = {
    created?: true
  }

  export type CommentSumAggregateInputType = {
    created?: true
  }

  export type CommentMinAggregateInputType = {
    id?: true
    body?: true
    creator?: true
    issueId?: true
    created?: true
  }

  export type CommentMaxAggregateInputType = {
    id?: true
    body?: true
    creator?: true
    issueId?: true
    created?: true
  }

  export type CommentCountAggregateInputType = {
    id?: true
    body?: true
    creator?: true
    issueId?: true
    created?: true
    _all?: true
  }

  export type CommentAggregateArgs = {
    /**
     * Filter which Comment to aggregate.
     * 
    **/
    where?: CommentWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Comments to fetch.
     * 
    **/
    orderBy?: Enumerable<CommentOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     * 
    **/
    cursor?: CommentWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Comments from the position of the cursor.
     * 
    **/
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Comments.
     * 
    **/
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Comments
    **/
    _count?: true | CommentCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: CommentAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: CommentSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: CommentMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: CommentMaxAggregateInputType
  }

  export type GetCommentAggregateType<T extends CommentAggregateArgs> = {
        [P in keyof T & keyof AggregateComment]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateComment[P]>
      : GetScalarType<T[P], AggregateComment[P]>
  }




  export type CommentGroupByArgs = {
    where?: CommentWhereInput
    orderBy?: Enumerable<CommentOrderByWithAggregationInput>
    by: Array<CommentScalarFieldEnum>
    having?: CommentScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: CommentCountAggregateInputType | true
    _avg?: CommentAvgAggregateInputType
    _sum?: CommentSumAggregateInputType
    _min?: CommentMinAggregateInputType
    _max?: CommentMaxAggregateInputType
  }


  export type CommentGroupByOutputType = {
    id: string
    body: string
    creator: string
    issueId: string
    created: number
    _count: CommentCountAggregateOutputType | null
    _avg: CommentAvgAggregateOutputType | null
    _sum: CommentSumAggregateOutputType | null
    _min: CommentMinAggregateOutputType | null
    _max: CommentMaxAggregateOutputType | null
  }

  type GetCommentGroupByPayload<T extends CommentGroupByArgs> = PrismaPromise<
    Array<
      PickArray<CommentGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof CommentGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], CommentGroupByOutputType[P]>
            : GetScalarType<T[P], CommentGroupByOutputType[P]>
        }
      >
    >


  export type CommentSelect = {
    id?: boolean
    body?: boolean
    creator?: boolean
    issueId?: boolean
    created?: boolean
    issue?: boolean | IssueArgs
  }


  export type CommentInclude = {
    issue?: boolean | IssueArgs
  } 

  export type CommentGetPayload<S extends boolean | null | undefined | CommentArgs> =
    S extends { select: any, include: any } ? 'Please either choose `select` or `include`' :
    S extends true ? Comment :
    S extends undefined ? never :
    S extends { include: any } & (CommentArgs | CommentFindManyArgs)
    ? Comment  & {
    [P in TruthyKeys<S['include']>]:
        P extends 'issue' ? IssueGetPayload<S['include'][P]> :  never
  } 
    : S extends { select: any } & (CommentArgs | CommentFindManyArgs)
      ? {
    [P in TruthyKeys<S['select']>]:
        P extends 'issue' ? IssueGetPayload<S['select'][P]> :  P extends keyof Comment ? Comment[P] : never
  } 
      : Comment


  type CommentCountArgs = Merge<
    Omit<CommentFindManyArgs, 'select' | 'include'> & {
      select?: CommentCountAggregateInputType | true
    }
  >

  export interface CommentDelegate<GlobalRejectSettings extends Prisma.RejectOnNotFound | Prisma.RejectPerOperation | false | undefined> {
    /**
     * Find zero or one Comment that matches the filter.
     * @param {CommentFindUniqueArgs} args - Arguments to find a Comment
     * @example
     * // Get one Comment
     * const comment = await prisma.comment.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUnique<T extends CommentFindUniqueArgs,  LocalRejectSettings = T["rejectOnNotFound"] extends RejectOnNotFound ? T['rejectOnNotFound'] : undefined>(
      args: SelectSubset<T, CommentFindUniqueArgs>
    ): HasReject<GlobalRejectSettings, LocalRejectSettings, 'findUnique', 'Comment'> extends True ? Prisma__CommentClient<CommentGetPayload<T>> : Prisma__CommentClient<CommentGetPayload<T> | null, null>

    /**
     * Find one Comment that matches the filter or throw an error  with `error.code='P2025'` 
     *     if no matches were found.
     * @param {CommentFindUniqueOrThrowArgs} args - Arguments to find a Comment
     * @example
     * // Get one Comment
     * const comment = await prisma.comment.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUniqueOrThrow<T extends CommentFindUniqueOrThrowArgs>(
      args?: SelectSubset<T, CommentFindUniqueOrThrowArgs>
    ): Prisma__CommentClient<CommentGetPayload<T>>

    /**
     * Find the first Comment that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {CommentFindFirstArgs} args - Arguments to find a Comment
     * @example
     * // Get one Comment
     * const comment = await prisma.comment.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirst<T extends CommentFindFirstArgs,  LocalRejectSettings = T["rejectOnNotFound"] extends RejectOnNotFound ? T['rejectOnNotFound'] : undefined>(
      args?: SelectSubset<T, CommentFindFirstArgs>
    ): HasReject<GlobalRejectSettings, LocalRejectSettings, 'findFirst', 'Comment'> extends True ? Prisma__CommentClient<CommentGetPayload<T>> : Prisma__CommentClient<CommentGetPayload<T> | null, null>

    /**
     * Find the first Comment that matches the filter or
     * throw `NotFoundError` if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {CommentFindFirstOrThrowArgs} args - Arguments to find a Comment
     * @example
     * // Get one Comment
     * const comment = await prisma.comment.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirstOrThrow<T extends CommentFindFirstOrThrowArgs>(
      args?: SelectSubset<T, CommentFindFirstOrThrowArgs>
    ): Prisma__CommentClient<CommentGetPayload<T>>

    /**
     * Find zero or more Comments that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {CommentFindManyArgs=} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Comments
     * const comments = await prisma.comment.findMany()
     * 
     * // Get first 10 Comments
     * const comments = await prisma.comment.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const commentWithIdOnly = await prisma.comment.findMany({ select: { id: true } })
     * 
    **/
    findMany<T extends CommentFindManyArgs>(
      args?: SelectSubset<T, CommentFindManyArgs>
    ): PrismaPromise<Array<CommentGetPayload<T>>>

    /**
     * Create a Comment.
     * @param {CommentCreateArgs} args - Arguments to create a Comment.
     * @example
     * // Create one Comment
     * const Comment = await prisma.comment.create({
     *   data: {
     *     // ... data to create a Comment
     *   }
     * })
     * 
    **/
    create<T extends CommentCreateArgs>(
      args: SelectSubset<T, CommentCreateArgs>
    ): Prisma__CommentClient<CommentGetPayload<T>>

    /**
     * Create many Comments.
     *     @param {CommentCreateManyArgs} args - Arguments to create many Comments.
     *     @example
     *     // Create many Comments
     *     const comment = await prisma.comment.createMany({
     *       data: {
     *         // ... provide data here
     *       }
     *     })
     *     
    **/
    createMany<T extends CommentCreateManyArgs>(
      args?: SelectSubset<T, CommentCreateManyArgs>
    ): PrismaPromise<BatchPayload>

    /**
     * Delete a Comment.
     * @param {CommentDeleteArgs} args - Arguments to delete one Comment.
     * @example
     * // Delete one Comment
     * const Comment = await prisma.comment.delete({
     *   where: {
     *     // ... filter to delete one Comment
     *   }
     * })
     * 
    **/
    delete<T extends CommentDeleteArgs>(
      args: SelectSubset<T, CommentDeleteArgs>
    ): Prisma__CommentClient<CommentGetPayload<T>>

    /**
     * Update one Comment.
     * @param {CommentUpdateArgs} args - Arguments to update one Comment.
     * @example
     * // Update one Comment
     * const comment = await prisma.comment.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    update<T extends CommentUpdateArgs>(
      args: SelectSubset<T, CommentUpdateArgs>
    ): Prisma__CommentClient<CommentGetPayload<T>>

    /**
     * Delete zero or more Comments.
     * @param {CommentDeleteManyArgs} args - Arguments to filter Comments to delete.
     * @example
     * // Delete a few Comments
     * const { count } = await prisma.comment.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
    **/
    deleteMany<T extends CommentDeleteManyArgs>(
      args?: SelectSubset<T, CommentDeleteManyArgs>
    ): PrismaPromise<BatchPayload>

    /**
     * Update zero or more Comments.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {CommentUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Comments
     * const comment = await prisma.comment.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    updateMany<T extends CommentUpdateManyArgs>(
      args: SelectSubset<T, CommentUpdateManyArgs>
    ): PrismaPromise<BatchPayload>

    /**
     * Create or update one Comment.
     * @param {CommentUpsertArgs} args - Arguments to update or create a Comment.
     * @example
     * // Update or create a Comment
     * const comment = await prisma.comment.upsert({
     *   create: {
     *     // ... data to create a Comment
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Comment we want to update
     *   }
     * })
    **/
    upsert<T extends CommentUpsertArgs>(
      args: SelectSubset<T, CommentUpsertArgs>
    ): Prisma__CommentClient<CommentGetPayload<T>>

    /**
     * Count the number of Comments.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {CommentCountArgs} args - Arguments to filter Comments to count.
     * @example
     * // Count the number of Comments
     * const count = await prisma.comment.count({
     *   where: {
     *     // ... the filter for the Comments we want to count
     *   }
     * })
    **/
    count<T extends CommentCountArgs>(
      args?: Subset<T, CommentCountArgs>,
    ): PrismaPromise<
      T extends _Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], CommentCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Comment.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {CommentAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends CommentAggregateArgs>(args: Subset<T, CommentAggregateArgs>): PrismaPromise<GetCommentAggregateType<T>>

    /**
     * Group by Comment.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {CommentGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends CommentGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: CommentGroupByArgs['orderBy'] }
        : { orderBy?: CommentGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends TupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, CommentGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetCommentGroupByPayload<T> : PrismaPromise<InputErrors>

  }

  /**
   * The delegate class that acts as a "Promise-like" for Comment.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export class Prisma__CommentClient<T, Null = never> implements PrismaPromise<T> {
    [prisma]: true;
    private readonly _dmmf;
    private readonly _fetcher;
    private readonly _queryType;
    private readonly _rootField;
    private readonly _clientMethod;
    private readonly _args;
    private readonly _dataPath;
    private readonly _errorFormat;
    private readonly _measurePerformance?;
    private _isList;
    private _callsite;
    private _requestPromise?;
    constructor(_dmmf: runtime.DMMFClass, _fetcher: PrismaClientFetcher, _queryType: 'query' | 'mutation', _rootField: string, _clientMethod: string, _args: any, _dataPath: string[], _errorFormat: ErrorFormat, _measurePerformance?: boolean | undefined, _isList?: boolean);
    readonly [Symbol.toStringTag]: 'PrismaClientPromise';

    issue<T extends IssueArgs= {}>(args?: Subset<T, IssueArgs>): Prisma__IssueClient<IssueGetPayload<T> | Null>;

    private get _document();
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): Promise<TResult1 | TResult2>;
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): Promise<T | TResult>;
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): Promise<T>;
  }



  // Custom InputTypes

  /**
   * Comment base type for findUnique actions
   */
  export type CommentFindUniqueArgsBase = {
    /**
     * Select specific fields to fetch from the Comment
     * 
    **/
    select?: CommentSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: CommentInclude | null
    /**
     * Filter, which Comment to fetch.
     * 
    **/
    where: CommentWhereUniqueInput
  }

  /**
   * Comment findUnique
   */
  export interface CommentFindUniqueArgs extends CommentFindUniqueArgsBase {
   /**
    * Throw an Error if query returns no results
    * @deprecated since 4.0.0: use `findUniqueOrThrow` method instead
    */
    rejectOnNotFound?: RejectOnNotFound
  }
      

  /**
   * Comment findUniqueOrThrow
   */
  export type CommentFindUniqueOrThrowArgs = {
    /**
     * Select specific fields to fetch from the Comment
     * 
    **/
    select?: CommentSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: CommentInclude | null
    /**
     * Filter, which Comment to fetch.
     * 
    **/
    where: CommentWhereUniqueInput
  }


  /**
   * Comment base type for findFirst actions
   */
  export type CommentFindFirstArgsBase = {
    /**
     * Select specific fields to fetch from the Comment
     * 
    **/
    select?: CommentSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: CommentInclude | null
    /**
     * Filter, which Comment to fetch.
     * 
    **/
    where?: CommentWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Comments to fetch.
     * 
    **/
    orderBy?: Enumerable<CommentOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Comments.
     * 
    **/
    cursor?: CommentWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Comments from the position of the cursor.
     * 
    **/
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Comments.
     * 
    **/
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Comments.
     * 
    **/
    distinct?: Enumerable<CommentScalarFieldEnum>
  }

  /**
   * Comment findFirst
   */
  export interface CommentFindFirstArgs extends CommentFindFirstArgsBase {
   /**
    * Throw an Error if query returns no results
    * @deprecated since 4.0.0: use `findFirstOrThrow` method instead
    */
    rejectOnNotFound?: RejectOnNotFound
  }
      

  /**
   * Comment findFirstOrThrow
   */
  export type CommentFindFirstOrThrowArgs = {
    /**
     * Select specific fields to fetch from the Comment
     * 
    **/
    select?: CommentSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: CommentInclude | null
    /**
     * Filter, which Comment to fetch.
     * 
    **/
    where?: CommentWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Comments to fetch.
     * 
    **/
    orderBy?: Enumerable<CommentOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Comments.
     * 
    **/
    cursor?: CommentWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Comments from the position of the cursor.
     * 
    **/
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Comments.
     * 
    **/
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Comments.
     * 
    **/
    distinct?: Enumerable<CommentScalarFieldEnum>
  }


  /**
   * Comment findMany
   */
  export type CommentFindManyArgs = {
    /**
     * Select specific fields to fetch from the Comment
     * 
    **/
    select?: CommentSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: CommentInclude | null
    /**
     * Filter, which Comments to fetch.
     * 
    **/
    where?: CommentWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Comments to fetch.
     * 
    **/
    orderBy?: Enumerable<CommentOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Comments.
     * 
    **/
    cursor?: CommentWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Comments from the position of the cursor.
     * 
    **/
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Comments.
     * 
    **/
    skip?: number
    distinct?: Enumerable<CommentScalarFieldEnum>
  }


  /**
   * Comment create
   */
  export type CommentCreateArgs = {
    /**
     * Select specific fields to fetch from the Comment
     * 
    **/
    select?: CommentSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: CommentInclude | null
    /**
     * The data needed to create a Comment.
     * 
    **/
    data: XOR<CommentCreateInput, CommentUncheckedCreateInput>
  }


  /**
   * Comment createMany
   */
  export type CommentCreateManyArgs = {
    /**
     * The data used to create many Comments.
     * 
    **/
    data: Enumerable<CommentCreateManyInput>
    skipDuplicates?: boolean
  }


  /**
   * Comment update
   */
  export type CommentUpdateArgs = {
    /**
     * Select specific fields to fetch from the Comment
     * 
    **/
    select?: CommentSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: CommentInclude | null
    /**
     * The data needed to update a Comment.
     * 
    **/
    data: XOR<CommentUpdateInput, CommentUncheckedUpdateInput>
    /**
     * Choose, which Comment to update.
     * 
    **/
    where: CommentWhereUniqueInput
  }


  /**
   * Comment updateMany
   */
  export type CommentUpdateManyArgs = {
    /**
     * The data used to update Comments.
     * 
    **/
    data: XOR<CommentUpdateManyMutationInput, CommentUncheckedUpdateManyInput>
    /**
     * Filter which Comments to update
     * 
    **/
    where?: CommentWhereInput
  }


  /**
   * Comment upsert
   */
  export type CommentUpsertArgs = {
    /**
     * Select specific fields to fetch from the Comment
     * 
    **/
    select?: CommentSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: CommentInclude | null
    /**
     * The filter to search for the Comment to update in case it exists.
     * 
    **/
    where: CommentWhereUniqueInput
    /**
     * In case the Comment found by the `where` argument doesn't exist, create a new Comment with this data.
     * 
    **/
    create: XOR<CommentCreateInput, CommentUncheckedCreateInput>
    /**
     * In case the Comment was found with the provided `where` argument, update it with this data.
     * 
    **/
    update: XOR<CommentUpdateInput, CommentUncheckedUpdateInput>
  }


  /**
   * Comment delete
   */
  export type CommentDeleteArgs = {
    /**
     * Select specific fields to fetch from the Comment
     * 
    **/
    select?: CommentSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: CommentInclude | null
    /**
     * Filter which Comment to delete.
     * 
    **/
    where: CommentWhereUniqueInput
  }


  /**
   * Comment deleteMany
   */
  export type CommentDeleteManyArgs = {
    /**
     * Filter which Comments to delete
     * 
    **/
    where?: CommentWhereInput
  }


  /**
   * Comment without action
   */
  export type CommentArgs = {
    /**
     * Select specific fields to fetch from the Comment
     * 
    **/
    select?: CommentSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: CommentInclude | null
  }



  /**
   * Model Description
   */


  export type AggregateDescription = {
    _count: DescriptionCountAggregateOutputType | null
    _min: DescriptionMinAggregateOutputType | null
    _max: DescriptionMaxAggregateOutputType | null
  }

  export type DescriptionMinAggregateOutputType = {
    id: string | null
    body: string | null
  }

  export type DescriptionMaxAggregateOutputType = {
    id: string | null
    body: string | null
  }

  export type DescriptionCountAggregateOutputType = {
    id: number
    body: number
    _all: number
  }


  export type DescriptionMinAggregateInputType = {
    id?: true
    body?: true
  }

  export type DescriptionMaxAggregateInputType = {
    id?: true
    body?: true
  }

  export type DescriptionCountAggregateInputType = {
    id?: true
    body?: true
    _all?: true
  }

  export type DescriptionAggregateArgs = {
    /**
     * Filter which Description to aggregate.
     * 
    **/
    where?: DescriptionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Descriptions to fetch.
     * 
    **/
    orderBy?: Enumerable<DescriptionOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     * 
    **/
    cursor?: DescriptionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Descriptions from the position of the cursor.
     * 
    **/
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Descriptions.
     * 
    **/
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Descriptions
    **/
    _count?: true | DescriptionCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: DescriptionMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: DescriptionMaxAggregateInputType
  }

  export type GetDescriptionAggregateType<T extends DescriptionAggregateArgs> = {
        [P in keyof T & keyof AggregateDescription]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateDescription[P]>
      : GetScalarType<T[P], AggregateDescription[P]>
  }




  export type DescriptionGroupByArgs = {
    where?: DescriptionWhereInput
    orderBy?: Enumerable<DescriptionOrderByWithAggregationInput>
    by: Array<DescriptionScalarFieldEnum>
    having?: DescriptionScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: DescriptionCountAggregateInputType | true
    _min?: DescriptionMinAggregateInputType
    _max?: DescriptionMaxAggregateInputType
  }


  export type DescriptionGroupByOutputType = {
    id: string
    body: string
    _count: DescriptionCountAggregateOutputType | null
    _min: DescriptionMinAggregateOutputType | null
    _max: DescriptionMaxAggregateOutputType | null
  }

  type GetDescriptionGroupByPayload<T extends DescriptionGroupByArgs> = PrismaPromise<
    Array<
      PickArray<DescriptionGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof DescriptionGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], DescriptionGroupByOutputType[P]>
            : GetScalarType<T[P], DescriptionGroupByOutputType[P]>
        }
      >
    >


  export type DescriptionSelect = {
    id?: boolean
    body?: boolean
    issue?: boolean | IssueArgs
  }


  export type DescriptionInclude = {
    issue?: boolean | IssueArgs
  } 

  export type DescriptionGetPayload<S extends boolean | null | undefined | DescriptionArgs> =
    S extends { select: any, include: any } ? 'Please either choose `select` or `include`' :
    S extends true ? Description :
    S extends undefined ? never :
    S extends { include: any } & (DescriptionArgs | DescriptionFindManyArgs)
    ? Description  & {
    [P in TruthyKeys<S['include']>]:
        P extends 'issue' ? IssueGetPayload<S['include'][P]> :  never
  } 
    : S extends { select: any } & (DescriptionArgs | DescriptionFindManyArgs)
      ? {
    [P in TruthyKeys<S['select']>]:
        P extends 'issue' ? IssueGetPayload<S['select'][P]> :  P extends keyof Description ? Description[P] : never
  } 
      : Description


  type DescriptionCountArgs = Merge<
    Omit<DescriptionFindManyArgs, 'select' | 'include'> & {
      select?: DescriptionCountAggregateInputType | true
    }
  >

  export interface DescriptionDelegate<GlobalRejectSettings extends Prisma.RejectOnNotFound | Prisma.RejectPerOperation | false | undefined> {
    /**
     * Find zero or one Description that matches the filter.
     * @param {DescriptionFindUniqueArgs} args - Arguments to find a Description
     * @example
     * // Get one Description
     * const description = await prisma.description.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUnique<T extends DescriptionFindUniqueArgs,  LocalRejectSettings = T["rejectOnNotFound"] extends RejectOnNotFound ? T['rejectOnNotFound'] : undefined>(
      args: SelectSubset<T, DescriptionFindUniqueArgs>
    ): HasReject<GlobalRejectSettings, LocalRejectSettings, 'findUnique', 'Description'> extends True ? Prisma__DescriptionClient<DescriptionGetPayload<T>> : Prisma__DescriptionClient<DescriptionGetPayload<T> | null, null>

    /**
     * Find one Description that matches the filter or throw an error  with `error.code='P2025'` 
     *     if no matches were found.
     * @param {DescriptionFindUniqueOrThrowArgs} args - Arguments to find a Description
     * @example
     * // Get one Description
     * const description = await prisma.description.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUniqueOrThrow<T extends DescriptionFindUniqueOrThrowArgs>(
      args?: SelectSubset<T, DescriptionFindUniqueOrThrowArgs>
    ): Prisma__DescriptionClient<DescriptionGetPayload<T>>

    /**
     * Find the first Description that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {DescriptionFindFirstArgs} args - Arguments to find a Description
     * @example
     * // Get one Description
     * const description = await prisma.description.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirst<T extends DescriptionFindFirstArgs,  LocalRejectSettings = T["rejectOnNotFound"] extends RejectOnNotFound ? T['rejectOnNotFound'] : undefined>(
      args?: SelectSubset<T, DescriptionFindFirstArgs>
    ): HasReject<GlobalRejectSettings, LocalRejectSettings, 'findFirst', 'Description'> extends True ? Prisma__DescriptionClient<DescriptionGetPayload<T>> : Prisma__DescriptionClient<DescriptionGetPayload<T> | null, null>

    /**
     * Find the first Description that matches the filter or
     * throw `NotFoundError` if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {DescriptionFindFirstOrThrowArgs} args - Arguments to find a Description
     * @example
     * // Get one Description
     * const description = await prisma.description.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirstOrThrow<T extends DescriptionFindFirstOrThrowArgs>(
      args?: SelectSubset<T, DescriptionFindFirstOrThrowArgs>
    ): Prisma__DescriptionClient<DescriptionGetPayload<T>>

    /**
     * Find zero or more Descriptions that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {DescriptionFindManyArgs=} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Descriptions
     * const descriptions = await prisma.description.findMany()
     * 
     * // Get first 10 Descriptions
     * const descriptions = await prisma.description.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const descriptionWithIdOnly = await prisma.description.findMany({ select: { id: true } })
     * 
    **/
    findMany<T extends DescriptionFindManyArgs>(
      args?: SelectSubset<T, DescriptionFindManyArgs>
    ): PrismaPromise<Array<DescriptionGetPayload<T>>>

    /**
     * Create a Description.
     * @param {DescriptionCreateArgs} args - Arguments to create a Description.
     * @example
     * // Create one Description
     * const Description = await prisma.description.create({
     *   data: {
     *     // ... data to create a Description
     *   }
     * })
     * 
    **/
    create<T extends DescriptionCreateArgs>(
      args: SelectSubset<T, DescriptionCreateArgs>
    ): Prisma__DescriptionClient<DescriptionGetPayload<T>>

    /**
     * Create many Descriptions.
     *     @param {DescriptionCreateManyArgs} args - Arguments to create many Descriptions.
     *     @example
     *     // Create many Descriptions
     *     const description = await prisma.description.createMany({
     *       data: {
     *         // ... provide data here
     *       }
     *     })
     *     
    **/
    createMany<T extends DescriptionCreateManyArgs>(
      args?: SelectSubset<T, DescriptionCreateManyArgs>
    ): PrismaPromise<BatchPayload>

    /**
     * Delete a Description.
     * @param {DescriptionDeleteArgs} args - Arguments to delete one Description.
     * @example
     * // Delete one Description
     * const Description = await prisma.description.delete({
     *   where: {
     *     // ... filter to delete one Description
     *   }
     * })
     * 
    **/
    delete<T extends DescriptionDeleteArgs>(
      args: SelectSubset<T, DescriptionDeleteArgs>
    ): Prisma__DescriptionClient<DescriptionGetPayload<T>>

    /**
     * Update one Description.
     * @param {DescriptionUpdateArgs} args - Arguments to update one Description.
     * @example
     * // Update one Description
     * const description = await prisma.description.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    update<T extends DescriptionUpdateArgs>(
      args: SelectSubset<T, DescriptionUpdateArgs>
    ): Prisma__DescriptionClient<DescriptionGetPayload<T>>

    /**
     * Delete zero or more Descriptions.
     * @param {DescriptionDeleteManyArgs} args - Arguments to filter Descriptions to delete.
     * @example
     * // Delete a few Descriptions
     * const { count } = await prisma.description.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
    **/
    deleteMany<T extends DescriptionDeleteManyArgs>(
      args?: SelectSubset<T, DescriptionDeleteManyArgs>
    ): PrismaPromise<BatchPayload>

    /**
     * Update zero or more Descriptions.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {DescriptionUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Descriptions
     * const description = await prisma.description.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    updateMany<T extends DescriptionUpdateManyArgs>(
      args: SelectSubset<T, DescriptionUpdateManyArgs>
    ): PrismaPromise<BatchPayload>

    /**
     * Create or update one Description.
     * @param {DescriptionUpsertArgs} args - Arguments to update or create a Description.
     * @example
     * // Update or create a Description
     * const description = await prisma.description.upsert({
     *   create: {
     *     // ... data to create a Description
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Description we want to update
     *   }
     * })
    **/
    upsert<T extends DescriptionUpsertArgs>(
      args: SelectSubset<T, DescriptionUpsertArgs>
    ): Prisma__DescriptionClient<DescriptionGetPayload<T>>

    /**
     * Count the number of Descriptions.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {DescriptionCountArgs} args - Arguments to filter Descriptions to count.
     * @example
     * // Count the number of Descriptions
     * const count = await prisma.description.count({
     *   where: {
     *     // ... the filter for the Descriptions we want to count
     *   }
     * })
    **/
    count<T extends DescriptionCountArgs>(
      args?: Subset<T, DescriptionCountArgs>,
    ): PrismaPromise<
      T extends _Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], DescriptionCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Description.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {DescriptionAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends DescriptionAggregateArgs>(args: Subset<T, DescriptionAggregateArgs>): PrismaPromise<GetDescriptionAggregateType<T>>

    /**
     * Group by Description.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {DescriptionGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends DescriptionGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: DescriptionGroupByArgs['orderBy'] }
        : { orderBy?: DescriptionGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends TupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, DescriptionGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetDescriptionGroupByPayload<T> : PrismaPromise<InputErrors>

  }

  /**
   * The delegate class that acts as a "Promise-like" for Description.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export class Prisma__DescriptionClient<T, Null = never> implements PrismaPromise<T> {
    [prisma]: true;
    private readonly _dmmf;
    private readonly _fetcher;
    private readonly _queryType;
    private readonly _rootField;
    private readonly _clientMethod;
    private readonly _args;
    private readonly _dataPath;
    private readonly _errorFormat;
    private readonly _measurePerformance?;
    private _isList;
    private _callsite;
    private _requestPromise?;
    constructor(_dmmf: runtime.DMMFClass, _fetcher: PrismaClientFetcher, _queryType: 'query' | 'mutation', _rootField: string, _clientMethod: string, _args: any, _dataPath: string[], _errorFormat: ErrorFormat, _measurePerformance?: boolean | undefined, _isList?: boolean);
    readonly [Symbol.toStringTag]: 'PrismaClientPromise';

    issue<T extends IssueArgs= {}>(args?: Subset<T, IssueArgs>): Prisma__IssueClient<IssueGetPayload<T> | Null>;

    private get _document();
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): Promise<TResult1 | TResult2>;
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): Promise<T | TResult>;
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): Promise<T>;
  }



  // Custom InputTypes

  /**
   * Description base type for findUnique actions
   */
  export type DescriptionFindUniqueArgsBase = {
    /**
     * Select specific fields to fetch from the Description
     * 
    **/
    select?: DescriptionSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: DescriptionInclude | null
    /**
     * Filter, which Description to fetch.
     * 
    **/
    where: DescriptionWhereUniqueInput
  }

  /**
   * Description findUnique
   */
  export interface DescriptionFindUniqueArgs extends DescriptionFindUniqueArgsBase {
   /**
    * Throw an Error if query returns no results
    * @deprecated since 4.0.0: use `findUniqueOrThrow` method instead
    */
    rejectOnNotFound?: RejectOnNotFound
  }
      

  /**
   * Description findUniqueOrThrow
   */
  export type DescriptionFindUniqueOrThrowArgs = {
    /**
     * Select specific fields to fetch from the Description
     * 
    **/
    select?: DescriptionSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: DescriptionInclude | null
    /**
     * Filter, which Description to fetch.
     * 
    **/
    where: DescriptionWhereUniqueInput
  }


  /**
   * Description base type for findFirst actions
   */
  export type DescriptionFindFirstArgsBase = {
    /**
     * Select specific fields to fetch from the Description
     * 
    **/
    select?: DescriptionSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: DescriptionInclude | null
    /**
     * Filter, which Description to fetch.
     * 
    **/
    where?: DescriptionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Descriptions to fetch.
     * 
    **/
    orderBy?: Enumerable<DescriptionOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Descriptions.
     * 
    **/
    cursor?: DescriptionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Descriptions from the position of the cursor.
     * 
    **/
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Descriptions.
     * 
    **/
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Descriptions.
     * 
    **/
    distinct?: Enumerable<DescriptionScalarFieldEnum>
  }

  /**
   * Description findFirst
   */
  export interface DescriptionFindFirstArgs extends DescriptionFindFirstArgsBase {
   /**
    * Throw an Error if query returns no results
    * @deprecated since 4.0.0: use `findFirstOrThrow` method instead
    */
    rejectOnNotFound?: RejectOnNotFound
  }
      

  /**
   * Description findFirstOrThrow
   */
  export type DescriptionFindFirstOrThrowArgs = {
    /**
     * Select specific fields to fetch from the Description
     * 
    **/
    select?: DescriptionSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: DescriptionInclude | null
    /**
     * Filter, which Description to fetch.
     * 
    **/
    where?: DescriptionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Descriptions to fetch.
     * 
    **/
    orderBy?: Enumerable<DescriptionOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Descriptions.
     * 
    **/
    cursor?: DescriptionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Descriptions from the position of the cursor.
     * 
    **/
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Descriptions.
     * 
    **/
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Descriptions.
     * 
    **/
    distinct?: Enumerable<DescriptionScalarFieldEnum>
  }


  /**
   * Description findMany
   */
  export type DescriptionFindManyArgs = {
    /**
     * Select specific fields to fetch from the Description
     * 
    **/
    select?: DescriptionSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: DescriptionInclude | null
    /**
     * Filter, which Descriptions to fetch.
     * 
    **/
    where?: DescriptionWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Descriptions to fetch.
     * 
    **/
    orderBy?: Enumerable<DescriptionOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Descriptions.
     * 
    **/
    cursor?: DescriptionWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Descriptions from the position of the cursor.
     * 
    **/
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Descriptions.
     * 
    **/
    skip?: number
    distinct?: Enumerable<DescriptionScalarFieldEnum>
  }


  /**
   * Description create
   */
  export type DescriptionCreateArgs = {
    /**
     * Select specific fields to fetch from the Description
     * 
    **/
    select?: DescriptionSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: DescriptionInclude | null
    /**
     * The data needed to create a Description.
     * 
    **/
    data: XOR<DescriptionCreateInput, DescriptionUncheckedCreateInput>
  }


  /**
   * Description createMany
   */
  export type DescriptionCreateManyArgs = {
    /**
     * The data used to create many Descriptions.
     * 
    **/
    data: Enumerable<DescriptionCreateManyInput>
    skipDuplicates?: boolean
  }


  /**
   * Description update
   */
  export type DescriptionUpdateArgs = {
    /**
     * Select specific fields to fetch from the Description
     * 
    **/
    select?: DescriptionSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: DescriptionInclude | null
    /**
     * The data needed to update a Description.
     * 
    **/
    data: XOR<DescriptionUpdateInput, DescriptionUncheckedUpdateInput>
    /**
     * Choose, which Description to update.
     * 
    **/
    where: DescriptionWhereUniqueInput
  }


  /**
   * Description updateMany
   */
  export type DescriptionUpdateManyArgs = {
    /**
     * The data used to update Descriptions.
     * 
    **/
    data: XOR<DescriptionUpdateManyMutationInput, DescriptionUncheckedUpdateManyInput>
    /**
     * Filter which Descriptions to update
     * 
    **/
    where?: DescriptionWhereInput
  }


  /**
   * Description upsert
   */
  export type DescriptionUpsertArgs = {
    /**
     * Select specific fields to fetch from the Description
     * 
    **/
    select?: DescriptionSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: DescriptionInclude | null
    /**
     * The filter to search for the Description to update in case it exists.
     * 
    **/
    where: DescriptionWhereUniqueInput
    /**
     * In case the Description found by the `where` argument doesn't exist, create a new Description with this data.
     * 
    **/
    create: XOR<DescriptionCreateInput, DescriptionUncheckedCreateInput>
    /**
     * In case the Description was found with the provided `where` argument, update it with this data.
     * 
    **/
    update: XOR<DescriptionUpdateInput, DescriptionUncheckedUpdateInput>
  }


  /**
   * Description delete
   */
  export type DescriptionDeleteArgs = {
    /**
     * Select specific fields to fetch from the Description
     * 
    **/
    select?: DescriptionSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: DescriptionInclude | null
    /**
     * Filter which Description to delete.
     * 
    **/
    where: DescriptionWhereUniqueInput
  }


  /**
   * Description deleteMany
   */
  export type DescriptionDeleteManyArgs = {
    /**
     * Filter which Descriptions to delete
     * 
    **/
    where?: DescriptionWhereInput
  }


  /**
   * Description without action
   */
  export type DescriptionArgs = {
    /**
     * Select specific fields to fetch from the Description
     * 
    **/
    select?: DescriptionSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: DescriptionInclude | null
  }



  /**
   * Model Issue
   */


  export type AggregateIssue = {
    _count: IssueCountAggregateOutputType | null
    _avg: IssueAvgAggregateOutputType | null
    _sum: IssueSumAggregateOutputType | null
    _min: IssueMinAggregateOutputType | null
    _max: IssueMaxAggregateOutputType | null
  }

  export type IssueAvgAggregateOutputType = {
    created: number | null
    modified: number | null
  }

  export type IssueSumAggregateOutputType = {
    created: number | null
    modified: number | null
  }

  export type IssueMinAggregateOutputType = {
    id: string | null
    title: string | null
    creator: string | null
    priority: string | null
    status: string | null
    created: number | null
    modified: number | null
    kanbanorder: string | null
  }

  export type IssueMaxAggregateOutputType = {
    id: string | null
    title: string | null
    creator: string | null
    priority: string | null
    status: string | null
    created: number | null
    modified: number | null
    kanbanorder: string | null
  }

  export type IssueCountAggregateOutputType = {
    id: number
    title: number
    creator: number
    priority: number
    status: number
    created: number
    modified: number
    kanbanorder: number
    _all: number
  }


  export type IssueAvgAggregateInputType = {
    created?: true
    modified?: true
  }

  export type IssueSumAggregateInputType = {
    created?: true
    modified?: true
  }

  export type IssueMinAggregateInputType = {
    id?: true
    title?: true
    creator?: true
    priority?: true
    status?: true
    created?: true
    modified?: true
    kanbanorder?: true
  }

  export type IssueMaxAggregateInputType = {
    id?: true
    title?: true
    creator?: true
    priority?: true
    status?: true
    created?: true
    modified?: true
    kanbanorder?: true
  }

  export type IssueCountAggregateInputType = {
    id?: true
    title?: true
    creator?: true
    priority?: true
    status?: true
    created?: true
    modified?: true
    kanbanorder?: true
    _all?: true
  }

  export type IssueAggregateArgs = {
    /**
     * Filter which Issue to aggregate.
     * 
    **/
    where?: IssueWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Issues to fetch.
     * 
    **/
    orderBy?: Enumerable<IssueOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     * 
    **/
    cursor?: IssueWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Issues from the position of the cursor.
     * 
    **/
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Issues.
     * 
    **/
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Issues
    **/
    _count?: true | IssueCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: IssueAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: IssueSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: IssueMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: IssueMaxAggregateInputType
  }

  export type GetIssueAggregateType<T extends IssueAggregateArgs> = {
        [P in keyof T & keyof AggregateIssue]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateIssue[P]>
      : GetScalarType<T[P], AggregateIssue[P]>
  }




  export type IssueGroupByArgs = {
    where?: IssueWhereInput
    orderBy?: Enumerable<IssueOrderByWithAggregationInput>
    by: Array<IssueScalarFieldEnum>
    having?: IssueScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: IssueCountAggregateInputType | true
    _avg?: IssueAvgAggregateInputType
    _sum?: IssueSumAggregateInputType
    _min?: IssueMinAggregateInputType
    _max?: IssueMaxAggregateInputType
  }


  export type IssueGroupByOutputType = {
    id: string
    title: string
    creator: string
    priority: string
    status: string
    created: number
    modified: number
    kanbanorder: string
    _count: IssueCountAggregateOutputType | null
    _avg: IssueAvgAggregateOutputType | null
    _sum: IssueSumAggregateOutputType | null
    _min: IssueMinAggregateOutputType | null
    _max: IssueMaxAggregateOutputType | null
  }

  type GetIssueGroupByPayload<T extends IssueGroupByArgs> = PrismaPromise<
    Array<
      PickArray<IssueGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof IssueGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], IssueGroupByOutputType[P]>
            : GetScalarType<T[P], IssueGroupByOutputType[P]>
        }
      >
    >


  export type IssueSelect = {
    id?: boolean
    title?: boolean
    creator?: boolean
    priority?: boolean
    status?: boolean
    created?: boolean
    modified?: boolean
    kanbanorder?: boolean
    comment?: boolean | Issue$commentArgs
    description?: boolean | DescriptionArgs
    _count?: boolean | IssueCountOutputTypeArgs
  }


  export type IssueInclude = {
    comment?: boolean | Issue$commentArgs
    description?: boolean | DescriptionArgs
    _count?: boolean | IssueCountOutputTypeArgs
  } 

  export type IssueGetPayload<S extends boolean | null | undefined | IssueArgs> =
    S extends { select: any, include: any } ? 'Please either choose `select` or `include`' :
    S extends true ? Issue :
    S extends undefined ? never :
    S extends { include: any } & (IssueArgs | IssueFindManyArgs)
    ? Issue  & {
    [P in TruthyKeys<S['include']>]:
        P extends 'comment' ? Array < CommentGetPayload<S['include'][P]>>  :
        P extends 'description' ? DescriptionGetPayload<S['include'][P]> | null :
        P extends '_count' ? IssueCountOutputTypeGetPayload<S['include'][P]> :  never
  } 
    : S extends { select: any } & (IssueArgs | IssueFindManyArgs)
      ? {
    [P in TruthyKeys<S['select']>]:
        P extends 'comment' ? Array < CommentGetPayload<S['select'][P]>>  :
        P extends 'description' ? DescriptionGetPayload<S['select'][P]> | null :
        P extends '_count' ? IssueCountOutputTypeGetPayload<S['select'][P]> :  P extends keyof Issue ? Issue[P] : never
  } 
      : Issue


  type IssueCountArgs = Merge<
    Omit<IssueFindManyArgs, 'select' | 'include'> & {
      select?: IssueCountAggregateInputType | true
    }
  >

  export interface IssueDelegate<GlobalRejectSettings extends Prisma.RejectOnNotFound | Prisma.RejectPerOperation | false | undefined> {
    /**
     * Find zero or one Issue that matches the filter.
     * @param {IssueFindUniqueArgs} args - Arguments to find a Issue
     * @example
     * // Get one Issue
     * const issue = await prisma.issue.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUnique<T extends IssueFindUniqueArgs,  LocalRejectSettings = T["rejectOnNotFound"] extends RejectOnNotFound ? T['rejectOnNotFound'] : undefined>(
      args: SelectSubset<T, IssueFindUniqueArgs>
    ): HasReject<GlobalRejectSettings, LocalRejectSettings, 'findUnique', 'Issue'> extends True ? Prisma__IssueClient<IssueGetPayload<T>> : Prisma__IssueClient<IssueGetPayload<T> | null, null>

    /**
     * Find one Issue that matches the filter or throw an error  with `error.code='P2025'` 
     *     if no matches were found.
     * @param {IssueFindUniqueOrThrowArgs} args - Arguments to find a Issue
     * @example
     * // Get one Issue
     * const issue = await prisma.issue.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUniqueOrThrow<T extends IssueFindUniqueOrThrowArgs>(
      args?: SelectSubset<T, IssueFindUniqueOrThrowArgs>
    ): Prisma__IssueClient<IssueGetPayload<T>>

    /**
     * Find the first Issue that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {IssueFindFirstArgs} args - Arguments to find a Issue
     * @example
     * // Get one Issue
     * const issue = await prisma.issue.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirst<T extends IssueFindFirstArgs,  LocalRejectSettings = T["rejectOnNotFound"] extends RejectOnNotFound ? T['rejectOnNotFound'] : undefined>(
      args?: SelectSubset<T, IssueFindFirstArgs>
    ): HasReject<GlobalRejectSettings, LocalRejectSettings, 'findFirst', 'Issue'> extends True ? Prisma__IssueClient<IssueGetPayload<T>> : Prisma__IssueClient<IssueGetPayload<T> | null, null>

    /**
     * Find the first Issue that matches the filter or
     * throw `NotFoundError` if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {IssueFindFirstOrThrowArgs} args - Arguments to find a Issue
     * @example
     * // Get one Issue
     * const issue = await prisma.issue.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirstOrThrow<T extends IssueFindFirstOrThrowArgs>(
      args?: SelectSubset<T, IssueFindFirstOrThrowArgs>
    ): Prisma__IssueClient<IssueGetPayload<T>>

    /**
     * Find zero or more Issues that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {IssueFindManyArgs=} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Issues
     * const issues = await prisma.issue.findMany()
     * 
     * // Get first 10 Issues
     * const issues = await prisma.issue.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const issueWithIdOnly = await prisma.issue.findMany({ select: { id: true } })
     * 
    **/
    findMany<T extends IssueFindManyArgs>(
      args?: SelectSubset<T, IssueFindManyArgs>
    ): PrismaPromise<Array<IssueGetPayload<T>>>

    /**
     * Create a Issue.
     * @param {IssueCreateArgs} args - Arguments to create a Issue.
     * @example
     * // Create one Issue
     * const Issue = await prisma.issue.create({
     *   data: {
     *     // ... data to create a Issue
     *   }
     * })
     * 
    **/
    create<T extends IssueCreateArgs>(
      args: SelectSubset<T, IssueCreateArgs>
    ): Prisma__IssueClient<IssueGetPayload<T>>

    /**
     * Create many Issues.
     *     @param {IssueCreateManyArgs} args - Arguments to create many Issues.
     *     @example
     *     // Create many Issues
     *     const issue = await prisma.issue.createMany({
     *       data: {
     *         // ... provide data here
     *       }
     *     })
     *     
    **/
    createMany<T extends IssueCreateManyArgs>(
      args?: SelectSubset<T, IssueCreateManyArgs>
    ): PrismaPromise<BatchPayload>

    /**
     * Delete a Issue.
     * @param {IssueDeleteArgs} args - Arguments to delete one Issue.
     * @example
     * // Delete one Issue
     * const Issue = await prisma.issue.delete({
     *   where: {
     *     // ... filter to delete one Issue
     *   }
     * })
     * 
    **/
    delete<T extends IssueDeleteArgs>(
      args: SelectSubset<T, IssueDeleteArgs>
    ): Prisma__IssueClient<IssueGetPayload<T>>

    /**
     * Update one Issue.
     * @param {IssueUpdateArgs} args - Arguments to update one Issue.
     * @example
     * // Update one Issue
     * const issue = await prisma.issue.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    update<T extends IssueUpdateArgs>(
      args: SelectSubset<T, IssueUpdateArgs>
    ): Prisma__IssueClient<IssueGetPayload<T>>

    /**
     * Delete zero or more Issues.
     * @param {IssueDeleteManyArgs} args - Arguments to filter Issues to delete.
     * @example
     * // Delete a few Issues
     * const { count } = await prisma.issue.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
    **/
    deleteMany<T extends IssueDeleteManyArgs>(
      args?: SelectSubset<T, IssueDeleteManyArgs>
    ): PrismaPromise<BatchPayload>

    /**
     * Update zero or more Issues.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {IssueUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Issues
     * const issue = await prisma.issue.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    updateMany<T extends IssueUpdateManyArgs>(
      args: SelectSubset<T, IssueUpdateManyArgs>
    ): PrismaPromise<BatchPayload>

    /**
     * Create or update one Issue.
     * @param {IssueUpsertArgs} args - Arguments to update or create a Issue.
     * @example
     * // Update or create a Issue
     * const issue = await prisma.issue.upsert({
     *   create: {
     *     // ... data to create a Issue
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Issue we want to update
     *   }
     * })
    **/
    upsert<T extends IssueUpsertArgs>(
      args: SelectSubset<T, IssueUpsertArgs>
    ): Prisma__IssueClient<IssueGetPayload<T>>

    /**
     * Count the number of Issues.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {IssueCountArgs} args - Arguments to filter Issues to count.
     * @example
     * // Count the number of Issues
     * const count = await prisma.issue.count({
     *   where: {
     *     // ... the filter for the Issues we want to count
     *   }
     * })
    **/
    count<T extends IssueCountArgs>(
      args?: Subset<T, IssueCountArgs>,
    ): PrismaPromise<
      T extends _Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], IssueCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Issue.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {IssueAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends IssueAggregateArgs>(args: Subset<T, IssueAggregateArgs>): PrismaPromise<GetIssueAggregateType<T>>

    /**
     * Group by Issue.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {IssueGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends IssueGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: IssueGroupByArgs['orderBy'] }
        : { orderBy?: IssueGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends TupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, IssueGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetIssueGroupByPayload<T> : PrismaPromise<InputErrors>

  }

  /**
   * The delegate class that acts as a "Promise-like" for Issue.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export class Prisma__IssueClient<T, Null = never> implements PrismaPromise<T> {
    [prisma]: true;
    private readonly _dmmf;
    private readonly _fetcher;
    private readonly _queryType;
    private readonly _rootField;
    private readonly _clientMethod;
    private readonly _args;
    private readonly _dataPath;
    private readonly _errorFormat;
    private readonly _measurePerformance?;
    private _isList;
    private _callsite;
    private _requestPromise?;
    constructor(_dmmf: runtime.DMMFClass, _fetcher: PrismaClientFetcher, _queryType: 'query' | 'mutation', _rootField: string, _clientMethod: string, _args: any, _dataPath: string[], _errorFormat: ErrorFormat, _measurePerformance?: boolean | undefined, _isList?: boolean);
    readonly [Symbol.toStringTag]: 'PrismaClientPromise';

    comment<T extends Issue$commentArgs= {}>(args?: Subset<T, Issue$commentArgs>): PrismaPromise<Array<CommentGetPayload<T>>| Null>;

    description<T extends DescriptionArgs= {}>(args?: Subset<T, DescriptionArgs>): Prisma__DescriptionClient<DescriptionGetPayload<T> | Null>;

    private get _document();
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): Promise<TResult1 | TResult2>;
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): Promise<T | TResult>;
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): Promise<T>;
  }



  // Custom InputTypes

  /**
   * Issue base type for findUnique actions
   */
  export type IssueFindUniqueArgsBase = {
    /**
     * Select specific fields to fetch from the Issue
     * 
    **/
    select?: IssueSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: IssueInclude | null
    /**
     * Filter, which Issue to fetch.
     * 
    **/
    where: IssueWhereUniqueInput
  }

  /**
   * Issue findUnique
   */
  export interface IssueFindUniqueArgs extends IssueFindUniqueArgsBase {
   /**
    * Throw an Error if query returns no results
    * @deprecated since 4.0.0: use `findUniqueOrThrow` method instead
    */
    rejectOnNotFound?: RejectOnNotFound
  }
      

  /**
   * Issue findUniqueOrThrow
   */
  export type IssueFindUniqueOrThrowArgs = {
    /**
     * Select specific fields to fetch from the Issue
     * 
    **/
    select?: IssueSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: IssueInclude | null
    /**
     * Filter, which Issue to fetch.
     * 
    **/
    where: IssueWhereUniqueInput
  }


  /**
   * Issue base type for findFirst actions
   */
  export type IssueFindFirstArgsBase = {
    /**
     * Select specific fields to fetch from the Issue
     * 
    **/
    select?: IssueSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: IssueInclude | null
    /**
     * Filter, which Issue to fetch.
     * 
    **/
    where?: IssueWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Issues to fetch.
     * 
    **/
    orderBy?: Enumerable<IssueOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Issues.
     * 
    **/
    cursor?: IssueWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Issues from the position of the cursor.
     * 
    **/
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Issues.
     * 
    **/
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Issues.
     * 
    **/
    distinct?: Enumerable<IssueScalarFieldEnum>
  }

  /**
   * Issue findFirst
   */
  export interface IssueFindFirstArgs extends IssueFindFirstArgsBase {
   /**
    * Throw an Error if query returns no results
    * @deprecated since 4.0.0: use `findFirstOrThrow` method instead
    */
    rejectOnNotFound?: RejectOnNotFound
  }
      

  /**
   * Issue findFirstOrThrow
   */
  export type IssueFindFirstOrThrowArgs = {
    /**
     * Select specific fields to fetch from the Issue
     * 
    **/
    select?: IssueSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: IssueInclude | null
    /**
     * Filter, which Issue to fetch.
     * 
    **/
    where?: IssueWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Issues to fetch.
     * 
    **/
    orderBy?: Enumerable<IssueOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Issues.
     * 
    **/
    cursor?: IssueWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Issues from the position of the cursor.
     * 
    **/
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Issues.
     * 
    **/
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Issues.
     * 
    **/
    distinct?: Enumerable<IssueScalarFieldEnum>
  }


  /**
   * Issue findMany
   */
  export type IssueFindManyArgs = {
    /**
     * Select specific fields to fetch from the Issue
     * 
    **/
    select?: IssueSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: IssueInclude | null
    /**
     * Filter, which Issues to fetch.
     * 
    **/
    where?: IssueWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Issues to fetch.
     * 
    **/
    orderBy?: Enumerable<IssueOrderByWithRelationInput>
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Issues.
     * 
    **/
    cursor?: IssueWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Issues from the position of the cursor.
     * 
    **/
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Issues.
     * 
    **/
    skip?: number
    distinct?: Enumerable<IssueScalarFieldEnum>
  }


  /**
   * Issue create
   */
  export type IssueCreateArgs = {
    /**
     * Select specific fields to fetch from the Issue
     * 
    **/
    select?: IssueSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: IssueInclude | null
    /**
     * The data needed to create a Issue.
     * 
    **/
    data: XOR<IssueCreateInput, IssueUncheckedCreateInput>
  }


  /**
   * Issue createMany
   */
  export type IssueCreateManyArgs = {
    /**
     * The data used to create many Issues.
     * 
    **/
    data: Enumerable<IssueCreateManyInput>
    skipDuplicates?: boolean
  }


  /**
   * Issue update
   */
  export type IssueUpdateArgs = {
    /**
     * Select specific fields to fetch from the Issue
     * 
    **/
    select?: IssueSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: IssueInclude | null
    /**
     * The data needed to update a Issue.
     * 
    **/
    data: XOR<IssueUpdateInput, IssueUncheckedUpdateInput>
    /**
     * Choose, which Issue to update.
     * 
    **/
    where: IssueWhereUniqueInput
  }


  /**
   * Issue updateMany
   */
  export type IssueUpdateManyArgs = {
    /**
     * The data used to update Issues.
     * 
    **/
    data: XOR<IssueUpdateManyMutationInput, IssueUncheckedUpdateManyInput>
    /**
     * Filter which Issues to update
     * 
    **/
    where?: IssueWhereInput
  }


  /**
   * Issue upsert
   */
  export type IssueUpsertArgs = {
    /**
     * Select specific fields to fetch from the Issue
     * 
    **/
    select?: IssueSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: IssueInclude | null
    /**
     * The filter to search for the Issue to update in case it exists.
     * 
    **/
    where: IssueWhereUniqueInput
    /**
     * In case the Issue found by the `where` argument doesn't exist, create a new Issue with this data.
     * 
    **/
    create: XOR<IssueCreateInput, IssueUncheckedCreateInput>
    /**
     * In case the Issue was found with the provided `where` argument, update it with this data.
     * 
    **/
    update: XOR<IssueUpdateInput, IssueUncheckedUpdateInput>
  }


  /**
   * Issue delete
   */
  export type IssueDeleteArgs = {
    /**
     * Select specific fields to fetch from the Issue
     * 
    **/
    select?: IssueSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: IssueInclude | null
    /**
     * Filter which Issue to delete.
     * 
    **/
    where: IssueWhereUniqueInput
  }


  /**
   * Issue deleteMany
   */
  export type IssueDeleteManyArgs = {
    /**
     * Filter which Issues to delete
     * 
    **/
    where?: IssueWhereInput
  }


  /**
   * Issue.comment
   */
  export type Issue$commentArgs = {
    /**
     * Select specific fields to fetch from the Comment
     * 
    **/
    select?: CommentSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: CommentInclude | null
    where?: CommentWhereInput
    orderBy?: Enumerable<CommentOrderByWithRelationInput>
    cursor?: CommentWhereUniqueInput
    take?: number
    skip?: number
    distinct?: Enumerable<CommentScalarFieldEnum>
  }


  /**
   * Issue without action
   */
  export type IssueArgs = {
    /**
     * Select specific fields to fetch from the Issue
     * 
    **/
    select?: IssueSelect | null
    /**
     * Choose, which related nodes to fetch as well.
     * 
    **/
    include?: IssueInclude | null
  }



  /**
   * Enums
   */

  // Based on
  // https://github.com/microsoft/TypeScript/issues/3192#issuecomment-261720275

  export const CommentScalarFieldEnum: {
    id: 'id',
    body: 'body',
    creator: 'creator',
    issueId: 'issueId',
    created: 'created'
  };

  export type CommentScalarFieldEnum = (typeof CommentScalarFieldEnum)[keyof typeof CommentScalarFieldEnum]


  export const DescriptionScalarFieldEnum: {
    id: 'id',
    body: 'body'
  };

  export type DescriptionScalarFieldEnum = (typeof DescriptionScalarFieldEnum)[keyof typeof DescriptionScalarFieldEnum]


  export const IssueScalarFieldEnum: {
    id: 'id',
    title: 'title',
    creator: 'creator',
    priority: 'priority',
    status: 'status',
    created: 'created',
    modified: 'modified',
    kanbanorder: 'kanbanorder'
  };

  export type IssueScalarFieldEnum = (typeof IssueScalarFieldEnum)[keyof typeof IssueScalarFieldEnum]


  export const QueryMode: {
    default: 'default',
    insensitive: 'insensitive'
  };

  export type QueryMode = (typeof QueryMode)[keyof typeof QueryMode]


  export const SortOrder: {
    asc: 'asc',
    desc: 'desc'
  };

  export type SortOrder = (typeof SortOrder)[keyof typeof SortOrder]


  export const TransactionIsolationLevel: {
    ReadUncommitted: 'ReadUncommitted',
    ReadCommitted: 'ReadCommitted',
    RepeatableRead: 'RepeatableRead',
    Serializable: 'Serializable'
  };

  export type TransactionIsolationLevel = (typeof TransactionIsolationLevel)[keyof typeof TransactionIsolationLevel]


  /**
   * Deep Input Types
   */


  export type CommentWhereInput = {
    AND?: Enumerable<CommentWhereInput>
    OR?: Enumerable<CommentWhereInput>
    NOT?: Enumerable<CommentWhereInput>
    id?: StringFilter | string
    body?: StringFilter | string
    creator?: StringFilter | string
    issueId?: StringFilter | string
    created?: FloatFilter | number
    issue?: XOR<IssueRelationFilter, IssueWhereInput>
  }

  export type CommentOrderByWithRelationInput = {
    id?: SortOrder
    body?: SortOrder
    creator?: SortOrder
    issueId?: SortOrder
    created?: SortOrder
    issue?: IssueOrderByWithRelationInput
  }

  export type CommentWhereUniqueInput = {
    id?: string
  }

  export type CommentOrderByWithAggregationInput = {
    id?: SortOrder
    body?: SortOrder
    creator?: SortOrder
    issueId?: SortOrder
    created?: SortOrder
    _count?: CommentCountOrderByAggregateInput
    _avg?: CommentAvgOrderByAggregateInput
    _max?: CommentMaxOrderByAggregateInput
    _min?: CommentMinOrderByAggregateInput
    _sum?: CommentSumOrderByAggregateInput
  }

  export type CommentScalarWhereWithAggregatesInput = {
    AND?: Enumerable<CommentScalarWhereWithAggregatesInput>
    OR?: Enumerable<CommentScalarWhereWithAggregatesInput>
    NOT?: Enumerable<CommentScalarWhereWithAggregatesInput>
    id?: StringWithAggregatesFilter | string
    body?: StringWithAggregatesFilter | string
    creator?: StringWithAggregatesFilter | string
    issueId?: StringWithAggregatesFilter | string
    created?: FloatWithAggregatesFilter | number
  }

  export type DescriptionWhereInput = {
    AND?: Enumerable<DescriptionWhereInput>
    OR?: Enumerable<DescriptionWhereInput>
    NOT?: Enumerable<DescriptionWhereInput>
    id?: StringFilter | string
    body?: StringFilter | string
    issue?: XOR<IssueRelationFilter, IssueWhereInput>
  }

  export type DescriptionOrderByWithRelationInput = {
    id?: SortOrder
    body?: SortOrder
    issue?: IssueOrderByWithRelationInput
  }

  export type DescriptionWhereUniqueInput = {
    id?: string
  }

  export type DescriptionOrderByWithAggregationInput = {
    id?: SortOrder
    body?: SortOrder
    _count?: DescriptionCountOrderByAggregateInput
    _max?: DescriptionMaxOrderByAggregateInput
    _min?: DescriptionMinOrderByAggregateInput
  }

  export type DescriptionScalarWhereWithAggregatesInput = {
    AND?: Enumerable<DescriptionScalarWhereWithAggregatesInput>
    OR?: Enumerable<DescriptionScalarWhereWithAggregatesInput>
    NOT?: Enumerable<DescriptionScalarWhereWithAggregatesInput>
    id?: StringWithAggregatesFilter | string
    body?: StringWithAggregatesFilter | string
  }

  export type IssueWhereInput = {
    AND?: Enumerable<IssueWhereInput>
    OR?: Enumerable<IssueWhereInput>
    NOT?: Enumerable<IssueWhereInput>
    id?: StringFilter | string
    title?: StringFilter | string
    creator?: StringFilter | string
    priority?: StringFilter | string
    status?: StringFilter | string
    created?: FloatFilter | number
    modified?: FloatFilter | number
    kanbanorder?: StringFilter | string
    comment?: CommentListRelationFilter
    description?: XOR<DescriptionRelationFilter, DescriptionWhereInput> | null
  }

  export type IssueOrderByWithRelationInput = {
    id?: SortOrder
    title?: SortOrder
    creator?: SortOrder
    priority?: SortOrder
    status?: SortOrder
    created?: SortOrder
    modified?: SortOrder
    kanbanorder?: SortOrder
    comment?: CommentOrderByRelationAggregateInput
    description?: DescriptionOrderByWithRelationInput
  }

  export type IssueWhereUniqueInput = {
    id?: string
  }

  export type IssueOrderByWithAggregationInput = {
    id?: SortOrder
    title?: SortOrder
    creator?: SortOrder
    priority?: SortOrder
    status?: SortOrder
    created?: SortOrder
    modified?: SortOrder
    kanbanorder?: SortOrder
    _count?: IssueCountOrderByAggregateInput
    _avg?: IssueAvgOrderByAggregateInput
    _max?: IssueMaxOrderByAggregateInput
    _min?: IssueMinOrderByAggregateInput
    _sum?: IssueSumOrderByAggregateInput
  }

  export type IssueScalarWhereWithAggregatesInput = {
    AND?: Enumerable<IssueScalarWhereWithAggregatesInput>
    OR?: Enumerable<IssueScalarWhereWithAggregatesInput>
    NOT?: Enumerable<IssueScalarWhereWithAggregatesInput>
    id?: StringWithAggregatesFilter | string
    title?: StringWithAggregatesFilter | string
    creator?: StringWithAggregatesFilter | string
    priority?: StringWithAggregatesFilter | string
    status?: StringWithAggregatesFilter | string
    created?: FloatWithAggregatesFilter | number
    modified?: FloatWithAggregatesFilter | number
    kanbanorder?: StringWithAggregatesFilter | string
  }

  export type CommentCreateInput = {
    id: string
    body: string
    creator: string
    created: number
    issue: IssueCreateNestedOneWithoutCommentInput
  }

  export type CommentUncheckedCreateInput = {
    id: string
    body: string
    creator: string
    issueId: string
    created: number
  }

  export type CommentUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    body?: StringFieldUpdateOperationsInput | string
    creator?: StringFieldUpdateOperationsInput | string
    created?: FloatFieldUpdateOperationsInput | number
    issue?: IssueUpdateOneRequiredWithoutCommentNestedInput
  }

  export type CommentUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    body?: StringFieldUpdateOperationsInput | string
    creator?: StringFieldUpdateOperationsInput | string
    issueId?: StringFieldUpdateOperationsInput | string
    created?: FloatFieldUpdateOperationsInput | number
  }

  export type CommentCreateManyInput = {
    id: string
    body: string
    creator: string
    issueId: string
    created: number
  }

  export type CommentUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    body?: StringFieldUpdateOperationsInput | string
    creator?: StringFieldUpdateOperationsInput | string
    created?: FloatFieldUpdateOperationsInput | number
  }

  export type CommentUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    body?: StringFieldUpdateOperationsInput | string
    creator?: StringFieldUpdateOperationsInput | string
    issueId?: StringFieldUpdateOperationsInput | string
    created?: FloatFieldUpdateOperationsInput | number
  }

  export type DescriptionCreateInput = {
    body: string
    issue: IssueCreateNestedOneWithoutDescriptionInput
  }

  export type DescriptionUncheckedCreateInput = {
    id: string
    body: string
  }

  export type DescriptionUpdateInput = {
    body?: StringFieldUpdateOperationsInput | string
    issue?: IssueUpdateOneRequiredWithoutDescriptionNestedInput
  }

  export type DescriptionUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    body?: StringFieldUpdateOperationsInput | string
  }

  export type DescriptionCreateManyInput = {
    id: string
    body: string
  }

  export type DescriptionUpdateManyMutationInput = {
    body?: StringFieldUpdateOperationsInput | string
  }

  export type DescriptionUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    body?: StringFieldUpdateOperationsInput | string
  }

  export type IssueCreateInput = {
    id: string
    title: string
    creator: string
    priority: string
    status: string
    created: number
    modified: number
    kanbanorder: string
    comment?: CommentCreateNestedManyWithoutIssueInput
    description?: DescriptionCreateNestedOneWithoutIssueInput
  }

  export type IssueUncheckedCreateInput = {
    id: string
    title: string
    creator: string
    priority: string
    status: string
    created: number
    modified: number
    kanbanorder: string
    comment?: CommentUncheckedCreateNestedManyWithoutIssueInput
    description?: DescriptionUncheckedCreateNestedOneWithoutIssueInput
  }

  export type IssueUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    creator?: StringFieldUpdateOperationsInput | string
    priority?: StringFieldUpdateOperationsInput | string
    status?: StringFieldUpdateOperationsInput | string
    created?: FloatFieldUpdateOperationsInput | number
    modified?: FloatFieldUpdateOperationsInput | number
    kanbanorder?: StringFieldUpdateOperationsInput | string
    comment?: CommentUpdateManyWithoutIssueNestedInput
    description?: DescriptionUpdateOneWithoutIssueNestedInput
  }

  export type IssueUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    creator?: StringFieldUpdateOperationsInput | string
    priority?: StringFieldUpdateOperationsInput | string
    status?: StringFieldUpdateOperationsInput | string
    created?: FloatFieldUpdateOperationsInput | number
    modified?: FloatFieldUpdateOperationsInput | number
    kanbanorder?: StringFieldUpdateOperationsInput | string
    comment?: CommentUncheckedUpdateManyWithoutIssueNestedInput
    description?: DescriptionUncheckedUpdateOneWithoutIssueNestedInput
  }

  export type IssueCreateManyInput = {
    id: string
    title: string
    creator: string
    priority: string
    status: string
    created: number
    modified: number
    kanbanorder: string
  }

  export type IssueUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    creator?: StringFieldUpdateOperationsInput | string
    priority?: StringFieldUpdateOperationsInput | string
    status?: StringFieldUpdateOperationsInput | string
    created?: FloatFieldUpdateOperationsInput | number
    modified?: FloatFieldUpdateOperationsInput | number
    kanbanorder?: StringFieldUpdateOperationsInput | string
  }

  export type IssueUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    creator?: StringFieldUpdateOperationsInput | string
    priority?: StringFieldUpdateOperationsInput | string
    status?: StringFieldUpdateOperationsInput | string
    created?: FloatFieldUpdateOperationsInput | number
    modified?: FloatFieldUpdateOperationsInput | number
    kanbanorder?: StringFieldUpdateOperationsInput | string
  }

  export type StringFilter = {
    equals?: string
    in?: Enumerable<string>
    notIn?: Enumerable<string>
    lt?: string
    lte?: string
    gt?: string
    gte?: string
    contains?: string
    startsWith?: string
    endsWith?: string
    mode?: QueryMode
    not?: NestedStringFilter | string
  }

  export type FloatFilter = {
    equals?: number
    in?: Enumerable<number>
    notIn?: Enumerable<number>
    lt?: number
    lte?: number
    gt?: number
    gte?: number
    not?: NestedFloatFilter | number
  }

  export type IssueRelationFilter = {
    is?: IssueWhereInput
    isNot?: IssueWhereInput
  }

  export type CommentCountOrderByAggregateInput = {
    id?: SortOrder
    body?: SortOrder
    creator?: SortOrder
    issueId?: SortOrder
    created?: SortOrder
  }

  export type CommentAvgOrderByAggregateInput = {
    created?: SortOrder
  }

  export type CommentMaxOrderByAggregateInput = {
    id?: SortOrder
    body?: SortOrder
    creator?: SortOrder
    issueId?: SortOrder
    created?: SortOrder
  }

  export type CommentMinOrderByAggregateInput = {
    id?: SortOrder
    body?: SortOrder
    creator?: SortOrder
    issueId?: SortOrder
    created?: SortOrder
  }

  export type CommentSumOrderByAggregateInput = {
    created?: SortOrder
  }

  export type StringWithAggregatesFilter = {
    equals?: string
    in?: Enumerable<string>
    notIn?: Enumerable<string>
    lt?: string
    lte?: string
    gt?: string
    gte?: string
    contains?: string
    startsWith?: string
    endsWith?: string
    mode?: QueryMode
    not?: NestedStringWithAggregatesFilter | string
    _count?: NestedIntFilter
    _min?: NestedStringFilter
    _max?: NestedStringFilter
  }

  export type FloatWithAggregatesFilter = {
    equals?: number
    in?: Enumerable<number>
    notIn?: Enumerable<number>
    lt?: number
    lte?: number
    gt?: number
    gte?: number
    not?: NestedFloatWithAggregatesFilter | number
    _count?: NestedIntFilter
    _avg?: NestedFloatFilter
    _sum?: NestedFloatFilter
    _min?: NestedFloatFilter
    _max?: NestedFloatFilter
  }

  export type DescriptionCountOrderByAggregateInput = {
    id?: SortOrder
    body?: SortOrder
  }

  export type DescriptionMaxOrderByAggregateInput = {
    id?: SortOrder
    body?: SortOrder
  }

  export type DescriptionMinOrderByAggregateInput = {
    id?: SortOrder
    body?: SortOrder
  }

  export type CommentListRelationFilter = {
    every?: CommentWhereInput
    some?: CommentWhereInput
    none?: CommentWhereInput
  }

  export type DescriptionRelationFilter = {
    is?: DescriptionWhereInput | null
    isNot?: DescriptionWhereInput | null
  }

  export type CommentOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type IssueCountOrderByAggregateInput = {
    id?: SortOrder
    title?: SortOrder
    creator?: SortOrder
    priority?: SortOrder
    status?: SortOrder
    created?: SortOrder
    modified?: SortOrder
    kanbanorder?: SortOrder
  }

  export type IssueAvgOrderByAggregateInput = {
    created?: SortOrder
    modified?: SortOrder
  }

  export type IssueMaxOrderByAggregateInput = {
    id?: SortOrder
    title?: SortOrder
    creator?: SortOrder
    priority?: SortOrder
    status?: SortOrder
    created?: SortOrder
    modified?: SortOrder
    kanbanorder?: SortOrder
  }

  export type IssueMinOrderByAggregateInput = {
    id?: SortOrder
    title?: SortOrder
    creator?: SortOrder
    priority?: SortOrder
    status?: SortOrder
    created?: SortOrder
    modified?: SortOrder
    kanbanorder?: SortOrder
  }

  export type IssueSumOrderByAggregateInput = {
    created?: SortOrder
    modified?: SortOrder
  }

  export type IssueCreateNestedOneWithoutCommentInput = {
    create?: XOR<IssueCreateWithoutCommentInput, IssueUncheckedCreateWithoutCommentInput>
    connectOrCreate?: IssueCreateOrConnectWithoutCommentInput
    connect?: IssueWhereUniqueInput
  }

  export type StringFieldUpdateOperationsInput = {
    set?: string
  }

  export type FloatFieldUpdateOperationsInput = {
    set?: number
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
  }

  export type IssueUpdateOneRequiredWithoutCommentNestedInput = {
    create?: XOR<IssueCreateWithoutCommentInput, IssueUncheckedCreateWithoutCommentInput>
    connectOrCreate?: IssueCreateOrConnectWithoutCommentInput
    upsert?: IssueUpsertWithoutCommentInput
    connect?: IssueWhereUniqueInput
    update?: XOR<IssueUpdateWithoutCommentInput, IssueUncheckedUpdateWithoutCommentInput>
  }

  export type IssueCreateNestedOneWithoutDescriptionInput = {
    create?: XOR<IssueCreateWithoutDescriptionInput, IssueUncheckedCreateWithoutDescriptionInput>
    connectOrCreate?: IssueCreateOrConnectWithoutDescriptionInput
    connect?: IssueWhereUniqueInput
  }

  export type IssueUpdateOneRequiredWithoutDescriptionNestedInput = {
    create?: XOR<IssueCreateWithoutDescriptionInput, IssueUncheckedCreateWithoutDescriptionInput>
    connectOrCreate?: IssueCreateOrConnectWithoutDescriptionInput
    upsert?: IssueUpsertWithoutDescriptionInput
    connect?: IssueWhereUniqueInput
    update?: XOR<IssueUpdateWithoutDescriptionInput, IssueUncheckedUpdateWithoutDescriptionInput>
  }

  export type CommentCreateNestedManyWithoutIssueInput = {
    create?: XOR<Enumerable<CommentCreateWithoutIssueInput>, Enumerable<CommentUncheckedCreateWithoutIssueInput>>
    connectOrCreate?: Enumerable<CommentCreateOrConnectWithoutIssueInput>
    createMany?: CommentCreateManyIssueInputEnvelope
    connect?: Enumerable<CommentWhereUniqueInput>
  }

  export type DescriptionCreateNestedOneWithoutIssueInput = {
    create?: XOR<DescriptionCreateWithoutIssueInput, DescriptionUncheckedCreateWithoutIssueInput>
    connectOrCreate?: DescriptionCreateOrConnectWithoutIssueInput
    connect?: DescriptionWhereUniqueInput
  }

  export type CommentUncheckedCreateNestedManyWithoutIssueInput = {
    create?: XOR<Enumerable<CommentCreateWithoutIssueInput>, Enumerable<CommentUncheckedCreateWithoutIssueInput>>
    connectOrCreate?: Enumerable<CommentCreateOrConnectWithoutIssueInput>
    createMany?: CommentCreateManyIssueInputEnvelope
    connect?: Enumerable<CommentWhereUniqueInput>
  }

  export type DescriptionUncheckedCreateNestedOneWithoutIssueInput = {
    create?: XOR<DescriptionCreateWithoutIssueInput, DescriptionUncheckedCreateWithoutIssueInput>
    connectOrCreate?: DescriptionCreateOrConnectWithoutIssueInput
    connect?: DescriptionWhereUniqueInput
  }

  export type CommentUpdateManyWithoutIssueNestedInput = {
    create?: XOR<Enumerable<CommentCreateWithoutIssueInput>, Enumerable<CommentUncheckedCreateWithoutIssueInput>>
    connectOrCreate?: Enumerable<CommentCreateOrConnectWithoutIssueInput>
    upsert?: Enumerable<CommentUpsertWithWhereUniqueWithoutIssueInput>
    createMany?: CommentCreateManyIssueInputEnvelope
    set?: Enumerable<CommentWhereUniqueInput>
    disconnect?: Enumerable<CommentWhereUniqueInput>
    delete?: Enumerable<CommentWhereUniqueInput>
    connect?: Enumerable<CommentWhereUniqueInput>
    update?: Enumerable<CommentUpdateWithWhereUniqueWithoutIssueInput>
    updateMany?: Enumerable<CommentUpdateManyWithWhereWithoutIssueInput>
    deleteMany?: Enumerable<CommentScalarWhereInput>
  }

  export type DescriptionUpdateOneWithoutIssueNestedInput = {
    create?: XOR<DescriptionCreateWithoutIssueInput, DescriptionUncheckedCreateWithoutIssueInput>
    connectOrCreate?: DescriptionCreateOrConnectWithoutIssueInput
    upsert?: DescriptionUpsertWithoutIssueInput
    disconnect?: boolean
    delete?: boolean
    connect?: DescriptionWhereUniqueInput
    update?: XOR<DescriptionUpdateWithoutIssueInput, DescriptionUncheckedUpdateWithoutIssueInput>
  }

  export type CommentUncheckedUpdateManyWithoutIssueNestedInput = {
    create?: XOR<Enumerable<CommentCreateWithoutIssueInput>, Enumerable<CommentUncheckedCreateWithoutIssueInput>>
    connectOrCreate?: Enumerable<CommentCreateOrConnectWithoutIssueInput>
    upsert?: Enumerable<CommentUpsertWithWhereUniqueWithoutIssueInput>
    createMany?: CommentCreateManyIssueInputEnvelope
    set?: Enumerable<CommentWhereUniqueInput>
    disconnect?: Enumerable<CommentWhereUniqueInput>
    delete?: Enumerable<CommentWhereUniqueInput>
    connect?: Enumerable<CommentWhereUniqueInput>
    update?: Enumerable<CommentUpdateWithWhereUniqueWithoutIssueInput>
    updateMany?: Enumerable<CommentUpdateManyWithWhereWithoutIssueInput>
    deleteMany?: Enumerable<CommentScalarWhereInput>
  }

  export type DescriptionUncheckedUpdateOneWithoutIssueNestedInput = {
    create?: XOR<DescriptionCreateWithoutIssueInput, DescriptionUncheckedCreateWithoutIssueInput>
    connectOrCreate?: DescriptionCreateOrConnectWithoutIssueInput
    upsert?: DescriptionUpsertWithoutIssueInput
    disconnect?: boolean
    delete?: boolean
    connect?: DescriptionWhereUniqueInput
    update?: XOR<DescriptionUpdateWithoutIssueInput, DescriptionUncheckedUpdateWithoutIssueInput>
  }

  export type NestedStringFilter = {
    equals?: string
    in?: Enumerable<string>
    notIn?: Enumerable<string>
    lt?: string
    lte?: string
    gt?: string
    gte?: string
    contains?: string
    startsWith?: string
    endsWith?: string
    not?: NestedStringFilter | string
  }

  export type NestedFloatFilter = {
    equals?: number
    in?: Enumerable<number>
    notIn?: Enumerable<number>
    lt?: number
    lte?: number
    gt?: number
    gte?: number
    not?: NestedFloatFilter | number
  }

  export type NestedStringWithAggregatesFilter = {
    equals?: string
    in?: Enumerable<string>
    notIn?: Enumerable<string>
    lt?: string
    lte?: string
    gt?: string
    gte?: string
    contains?: string
    startsWith?: string
    endsWith?: string
    not?: NestedStringWithAggregatesFilter | string
    _count?: NestedIntFilter
    _min?: NestedStringFilter
    _max?: NestedStringFilter
  }

  export type NestedIntFilter = {
    equals?: number
    in?: Enumerable<number>
    notIn?: Enumerable<number>
    lt?: number
    lte?: number
    gt?: number
    gte?: number
    not?: NestedIntFilter | number
  }

  export type NestedFloatWithAggregatesFilter = {
    equals?: number
    in?: Enumerable<number>
    notIn?: Enumerable<number>
    lt?: number
    lte?: number
    gt?: number
    gte?: number
    not?: NestedFloatWithAggregatesFilter | number
    _count?: NestedIntFilter
    _avg?: NestedFloatFilter
    _sum?: NestedFloatFilter
    _min?: NestedFloatFilter
    _max?: NestedFloatFilter
  }

  export type IssueCreateWithoutCommentInput = {
    id: string
    title: string
    creator: string
    priority: string
    status: string
    created: number
    modified: number
    kanbanorder: string
    description?: DescriptionCreateNestedOneWithoutIssueInput
  }

  export type IssueUncheckedCreateWithoutCommentInput = {
    id: string
    title: string
    creator: string
    priority: string
    status: string
    created: number
    modified: number
    kanbanorder: string
    description?: DescriptionUncheckedCreateNestedOneWithoutIssueInput
  }

  export type IssueCreateOrConnectWithoutCommentInput = {
    where: IssueWhereUniqueInput
    create: XOR<IssueCreateWithoutCommentInput, IssueUncheckedCreateWithoutCommentInput>
  }

  export type IssueUpsertWithoutCommentInput = {
    update: XOR<IssueUpdateWithoutCommentInput, IssueUncheckedUpdateWithoutCommentInput>
    create: XOR<IssueCreateWithoutCommentInput, IssueUncheckedCreateWithoutCommentInput>
  }

  export type IssueUpdateWithoutCommentInput = {
    id?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    creator?: StringFieldUpdateOperationsInput | string
    priority?: StringFieldUpdateOperationsInput | string
    status?: StringFieldUpdateOperationsInput | string
    created?: FloatFieldUpdateOperationsInput | number
    modified?: FloatFieldUpdateOperationsInput | number
    kanbanorder?: StringFieldUpdateOperationsInput | string
    description?: DescriptionUpdateOneWithoutIssueNestedInput
  }

  export type IssueUncheckedUpdateWithoutCommentInput = {
    id?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    creator?: StringFieldUpdateOperationsInput | string
    priority?: StringFieldUpdateOperationsInput | string
    status?: StringFieldUpdateOperationsInput | string
    created?: FloatFieldUpdateOperationsInput | number
    modified?: FloatFieldUpdateOperationsInput | number
    kanbanorder?: StringFieldUpdateOperationsInput | string
    description?: DescriptionUncheckedUpdateOneWithoutIssueNestedInput
  }

  export type IssueCreateWithoutDescriptionInput = {
    id: string
    title: string
    creator: string
    priority: string
    status: string
    created: number
    modified: number
    kanbanorder: string
    comment?: CommentCreateNestedManyWithoutIssueInput
  }

  export type IssueUncheckedCreateWithoutDescriptionInput = {
    id: string
    title: string
    creator: string
    priority: string
    status: string
    created: number
    modified: number
    kanbanorder: string
    comment?: CommentUncheckedCreateNestedManyWithoutIssueInput
  }

  export type IssueCreateOrConnectWithoutDescriptionInput = {
    where: IssueWhereUniqueInput
    create: XOR<IssueCreateWithoutDescriptionInput, IssueUncheckedCreateWithoutDescriptionInput>
  }

  export type IssueUpsertWithoutDescriptionInput = {
    update: XOR<IssueUpdateWithoutDescriptionInput, IssueUncheckedUpdateWithoutDescriptionInput>
    create: XOR<IssueCreateWithoutDescriptionInput, IssueUncheckedCreateWithoutDescriptionInput>
  }

  export type IssueUpdateWithoutDescriptionInput = {
    id?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    creator?: StringFieldUpdateOperationsInput | string
    priority?: StringFieldUpdateOperationsInput | string
    status?: StringFieldUpdateOperationsInput | string
    created?: FloatFieldUpdateOperationsInput | number
    modified?: FloatFieldUpdateOperationsInput | number
    kanbanorder?: StringFieldUpdateOperationsInput | string
    comment?: CommentUpdateManyWithoutIssueNestedInput
  }

  export type IssueUncheckedUpdateWithoutDescriptionInput = {
    id?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    creator?: StringFieldUpdateOperationsInput | string
    priority?: StringFieldUpdateOperationsInput | string
    status?: StringFieldUpdateOperationsInput | string
    created?: FloatFieldUpdateOperationsInput | number
    modified?: FloatFieldUpdateOperationsInput | number
    kanbanorder?: StringFieldUpdateOperationsInput | string
    comment?: CommentUncheckedUpdateManyWithoutIssueNestedInput
  }

  export type CommentCreateWithoutIssueInput = {
    id: string
    body: string
    creator: string
    created: number
  }

  export type CommentUncheckedCreateWithoutIssueInput = {
    id: string
    body: string
    creator: string
    created: number
  }

  export type CommentCreateOrConnectWithoutIssueInput = {
    where: CommentWhereUniqueInput
    create: XOR<CommentCreateWithoutIssueInput, CommentUncheckedCreateWithoutIssueInput>
  }

  export type CommentCreateManyIssueInputEnvelope = {
    data: Enumerable<CommentCreateManyIssueInput>
    skipDuplicates?: boolean
  }

  export type DescriptionCreateWithoutIssueInput = {
    body: string
  }

  export type DescriptionUncheckedCreateWithoutIssueInput = {
    body: string
  }

  export type DescriptionCreateOrConnectWithoutIssueInput = {
    where: DescriptionWhereUniqueInput
    create: XOR<DescriptionCreateWithoutIssueInput, DescriptionUncheckedCreateWithoutIssueInput>
  }

  export type CommentUpsertWithWhereUniqueWithoutIssueInput = {
    where: CommentWhereUniqueInput
    update: XOR<CommentUpdateWithoutIssueInput, CommentUncheckedUpdateWithoutIssueInput>
    create: XOR<CommentCreateWithoutIssueInput, CommentUncheckedCreateWithoutIssueInput>
  }

  export type CommentUpdateWithWhereUniqueWithoutIssueInput = {
    where: CommentWhereUniqueInput
    data: XOR<CommentUpdateWithoutIssueInput, CommentUncheckedUpdateWithoutIssueInput>
  }

  export type CommentUpdateManyWithWhereWithoutIssueInput = {
    where: CommentScalarWhereInput
    data: XOR<CommentUpdateManyMutationInput, CommentUncheckedUpdateManyWithoutCommentInput>
  }

  export type CommentScalarWhereInput = {
    AND?: Enumerable<CommentScalarWhereInput>
    OR?: Enumerable<CommentScalarWhereInput>
    NOT?: Enumerable<CommentScalarWhereInput>
    id?: StringFilter | string
    body?: StringFilter | string
    creator?: StringFilter | string
    issueId?: StringFilter | string
    created?: FloatFilter | number
  }

  export type DescriptionUpsertWithoutIssueInput = {
    update: XOR<DescriptionUpdateWithoutIssueInput, DescriptionUncheckedUpdateWithoutIssueInput>
    create: XOR<DescriptionCreateWithoutIssueInput, DescriptionUncheckedCreateWithoutIssueInput>
  }

  export type DescriptionUpdateWithoutIssueInput = {
    body?: StringFieldUpdateOperationsInput | string
  }

  export type DescriptionUncheckedUpdateWithoutIssueInput = {
    body?: StringFieldUpdateOperationsInput | string
  }

  export type CommentCreateManyIssueInput = {
    id: string
    body: string
    creator: string
    created: number
  }

  export type CommentUpdateWithoutIssueInput = {
    id?: StringFieldUpdateOperationsInput | string
    body?: StringFieldUpdateOperationsInput | string
    creator?: StringFieldUpdateOperationsInput | string
    created?: FloatFieldUpdateOperationsInput | number
  }

  export type CommentUncheckedUpdateWithoutIssueInput = {
    id?: StringFieldUpdateOperationsInput | string
    body?: StringFieldUpdateOperationsInput | string
    creator?: StringFieldUpdateOperationsInput | string
    created?: FloatFieldUpdateOperationsInput | number
  }

  export type CommentUncheckedUpdateManyWithoutCommentInput = {
    id?: StringFieldUpdateOperationsInput | string
    body?: StringFieldUpdateOperationsInput | string
    creator?: StringFieldUpdateOperationsInput | string
    created?: FloatFieldUpdateOperationsInput | number
  }



  /**
   * Batch Payload for updateMany & deleteMany & createMany
   */

  export type BatchPayload = {
    count: number
  }

  /**
   * DMMF
   */
  export const dmmf: runtime.BaseDMMF
}