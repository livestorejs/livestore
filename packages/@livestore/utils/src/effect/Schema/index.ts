import { Effect, Hash, Result, Schema, SchemaAST, SchemaGetter, SchemaTransformation, Struct } from 'effect'
import { Transferable } from 'effect/unstable/workers'

import { shouldNeverHappen } from '../../misc.ts'

export * from 'effect/Schema'
export * from './debug-diff.ts'

export const pluck = <const K extends PropertyKey>(key: K) => <Fields extends { readonly [P in K]: Schema.Top }>(
  schema: Schema.Struct<Fields>
) => {
  return schema.mapFields(Struct.pick([key])).pipe(
    Schema.decodeTo(Schema.toType(schema.fields[key]), {
      decode: SchemaGetter.transform((whole: any) => whole[key]),
      encode: SchemaGetter.transform((value) => ({ [key]: value } as any))
    })
  )
};

export const DateFromEpochMillis = Schema.Date.pipe(
  Schema.encodeTo(
    Schema.Number,
    SchemaTransformation.transform({
      decode: (epochMillis) => new Date(epochMillis),
      encode: (date) => date.getTime(),
    }),
  ),
).annotate({ identifier: 'DateFromEpochMillis' })

// NOTE this is a temporary workaround until Effect schema has a better way to hash schemas
// https://github.com/Effect-TS/effect/issues/2719
// TODO remove this once the issue is resolved
export const hash = (schema: Schema.Top) => {
  try {
    return Hash.string(JSON.stringify(schema.ast, null, 2))
  } catch {
    console.warn(
      `Schema hashing failed, falling back to hashing the shortend schema AST string. This is less reliable and may cause false positives.`,
    )
    return Hash.hash(schema.ast.toString())
  }
}

export const getResolvedPropertySignatures = (
  schema: Schema.Top,
): ReadonlyArray<SchemaAST.PropertySignature> => {
  const resolvedAst = SchemaAST.toType(schema.ast)
  return SchemaAST.isObjects(resolvedAst) === true ? resolvedAst.propertySignatures : []
}

export const encodeWithTransferables =
  <A, I>(schema: Schema.Codec<A, I>, options?: SchemaAST.ParseOptions) =>
  (a: A, overrideOptions?: SchemaAST.ParseOptions) =>
    Effect.gen(function* () {
      const collector = yield* Transferable.makeCollector

      const encoded = yield* Schema.encodeEffect(schema, options)(a, overrideOptions).pipe(
        Effect.provideService(Transferable.Collector, collector),
      )

      return [encoded, collector.readUnsafe()] as const
    })

export const decodeSyncDebug: <A, I>(
  schema: Schema.Codec<A, I>,
  options?: SchemaAST.ParseOptions,
) => (i: I, overrideOptions?: SchemaAST.ParseOptions) => A = (schema, options) => (input, overrideOptions) => {
  const res = Schema.decodeResult(schema, options)(input, overrideOptions)
  if (Result.isFailure(res)) {
    return shouldNeverHappen(`decodeSyncDebug failed:`, res.failure)
  } else {
    return res.success
  }
}

export const encodeSyncDebug: <A, I>(
  schema: Schema.Codec<A, I>,
  options?: SchemaAST.ParseOptions,
) => (a: A, overrideOptions?: SchemaAST.ParseOptions) => I = (schema, options) => (input, overrideOptions) => {
  const res = Schema.encodeResult(schema, options)(input, overrideOptions)
  if (Result.isFailure(res)) {
    return shouldNeverHappen(`encodeSyncDebug failed:`, res.failure)
  } else {
    return res.success
  }
}
