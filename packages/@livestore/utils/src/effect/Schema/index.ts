import {
  Array,
  Effect,
  Function,
  Hash,
  Option,
  Result,
  Schema,
  SchemaAST,
  SchemaGetter,
  SchemaIssue,
  SchemaTransformation,
  Struct,
} from 'effect'
import { Transferable } from 'effect/unstable/workers'

import { shouldNeverHappen } from '../../misc.ts'

export * from 'effect/Schema'
export * from './debug-diff.ts'

type PluckSchema<Fields extends Schema.Struct.Fields, K extends keyof Fields> = Schema.Codec<
  Fields[K]['Type'],
  Schema.Struct<Pick<Fields, K>>['Encoded'],
  Schema.Struct<Pick<Fields, K>>['DecodingServices'],
  Schema.Struct<Pick<Fields, K>>['EncodingServices']
>

export const pluck =
  <const K extends PropertyKey>(key: K) =>
  <Fields extends { readonly [P in K]: Schema.Top }>(
    schema: Schema.Struct<Fields>,
  ): PluckSchema<Fields, K & keyof Fields> => {
    const field = schema.fields[key] as Fields[K & keyof Fields]

    return schema.mapFields(Struct.pick([key])).pipe(
      Schema.decodeTo(Schema.toType(field), {
        decode: SchemaGetter.transform((whole: any) => whole[key]),
        encode: SchemaGetter.transform((value) => ({ [key]: value }) as any),
      }),
    ) as unknown as PluckSchema<Fields, K & keyof Fields>
  }

/**
 * Like {@link fromJsonString}, but the ENCODED form is an *indented* JSON string
 * (default 2-space) instead of compact — for committed/human-read JSON files
 * (package.json, release plans, CI previews) that must stay diff-friendly while
 * still round-tripping through the schema. `fromJsonString` hardcodes a compact
 * `stringifyJson()`; we compose the schema's encoded side with an indenting one.
 *
 * Use a concrete schema for known shapes (adds validation) or `Schema.Unknown`
 * for open-ended ones (the indented analogue of `UnknownFromJsonString`).
 */
export const jsonStringIndented = <S extends Schema.Top>(schema: S, space: number | string = 2) =>
  schema.pipe(
    Schema.encodeTo(Schema.String, {
      decode: SchemaGetter.parseJson(),
      encode: SchemaGetter.stringifyJson({ space }),
    }),
  )

export const head = <S extends Schema.Top>(
  array: Schema.$Array<S>,
): Schema.decodeTo<Schema.Option<Schema.toType<S>>, Schema.$Array<S>> =>
  array.pipe(
    Schema.decodeTo(
      Schema.Option(Schema.toType(array.value)),
      SchemaTransformation.transform({
        decode: Array.head,
        encode: Option.match({
          onNone: () => [],
          onSome: Array.of,
        }),
      }),
    ),
  )

type HeadOrElse<S extends Schema.Top> = Schema.decodeTo<Schema.toType<S>, Schema.$Array<S>>

export const headOrElse: {
  <S extends Schema.Top>(array: Schema.$Array<S>, orElse?: () => S['Type']): HeadOrElse<S>
  (): <S extends Schema.Top>(array: Schema.$Array<S>) => HeadOrElse<S>
  <S extends Schema.Top>(orElse: () => S['Type']): (array: Schema.$Array<S>) => HeadOrElse<S>
} = Function.dual(
  (args) => Schema.isSchema(args[0]),
  <S extends Schema.Top>(array: Schema.$Array<S>, orElse?: () => S['Type']): HeadOrElse<S> =>
    array.pipe(
      Schema.decodeTo(
        Schema.toType(array.value),
        SchemaTransformation.transformOrFail({
          decode: (array) =>
            Array.isReadonlyArrayNonEmpty(array) === true
              ? Effect.succeed(Array.headNonEmpty(array))
              : orElse === undefined
                ? Effect.fail(
                    new SchemaIssue.InvalidValue(Option.some(array), {
                      message: 'Unable to retrieve the first element of an empty array',
                    }),
                  )
                : Effect.succeed(orElse()),
          encode: (value) => Effect.succeed(Array.of(value)),
        }),
      ),
    ),
)

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

export const getResolvedPropertySignatures = (schema: Schema.Top): ReadonlyArray<SchemaAST.PropertySignature> => {
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
  if (Result.isFailure(res) === true) {
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
  if (Result.isFailure(res) === true) {
    return shouldNeverHappen(`encodeSyncDebug failed:`, res.failure)
  } else {
    return res.success
  }
}
