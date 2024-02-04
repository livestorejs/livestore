import type { BindValues } from '@livestore/sql-queries'
import { Schema } from '@livestore/utils/effect'

export type MutationDefMap = Map<string, MutationDef.Any>
export type MutationDefRecord = Record<string, MutationDef.Any>

export type MutationDef<TName extends string, TFrom, TTo> = {
  name: TName
  schema: Schema.Schema<never, TFrom, TTo>
  sql: string | ((args: TTo) => string | { sql: string; bindValues: BindValues; writeTables?: ReadonlySet<string> })

  (args: TTo): { mutation: TName; args: TTo }
}

export namespace MutationDef {
  export type Any = MutationDef<string, any, any>
}

// export const defineMutations = <TMutationsMap extends MutationsMap>(mutations: TMutationsMap) => mutations

export const defineMutation = <TName extends string, TFrom, TTo>(
  name: TName,
  schema: Schema.Schema<never, TFrom, TTo>,
  sql: string | ((args: TTo) => string | { sql: string; bindValues: BindValues; writeTables?: ReadonlySet<string> }),
): MutationDef<TName, TFrom, TTo> => {
  const makeEvent = (args: TTo) => ({ mutation: name, args })

  Object.defineProperty(makeEvent, 'name', { value: name })
  Object.defineProperty(makeEvent, 'schema', { value: schema })
  Object.defineProperty(makeEvent, 'sql', { value: sql })

  return makeEvent as MutationDef<TName, TFrom, TTo>
}

export const rawSqlMutation = defineMutation(
  'livestore.RawSql',
  Schema.struct({
    sql: Schema.string,
    bindValues: Schema.optional(Schema.record(Schema.string, Schema.any)),
    writeTables: Schema.optional(Schema.readonlySet(Schema.string)),
  }),
  ({ sql, bindValues, writeTables }) => ({ sql, bindValues: bindValues ?? {}, writeTables }),
)

export type RawSqlMutation = typeof rawSqlMutation
export type RawSqlMutationArgs = ReturnType<typeof rawSqlMutation>

export type MutationArgs<
  TMutationsDefRecord extends MutationDefRecord,
  TMutationName extends keyof TMutationsDefRecord & string = keyof TMutationsDefRecord & string,
> = {
  mutation: TMutationName
  args: Schema.Schema.To<TMutationsDefRecord[TMutationName]['schema']>
}

export namespace MutationArgs {
  export type Any = MutationArgs<MutationDefRecord, string>
}

export type MutationArgsSchema<TMutationsDefRecord extends MutationDefRecord> = Schema.Schema<
  never,
  {
    [K in keyof TMutationsDefRecord]: {
      mutation: K
      args: Schema.Schema.From<TMutationsDefRecord[K]['schema']>
    }
  }[keyof TMutationsDefRecord],
  {
    [K in keyof TMutationsDefRecord]: {
      mutation: K
      args: Schema.Schema.To<TMutationsDefRecord[K]['schema']>
    }
  }[keyof TMutationsDefRecord]
>

export const makeMutationArgsSchema = <TMutationsDefRecord extends MutationDefRecord>(
  mutationDefRecord: TMutationsDefRecord,
): MutationArgsSchema<TMutationsDefRecord> =>
  Schema.union(
    ...Object.entries(mutationDefRecord).map(([name, def]) =>
      Schema.struct({ mutation: Schema.literal(name), args: def.schema }),
    ),
  ) as any
