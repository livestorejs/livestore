import { Transferable } from 'effect/unstable/workers'
import { Effect, Hash, Result, Schema as Schema_, SchemaIssue, SchemaParser, SchemaTransformation } from 'effect'
import type { ParseOptions } from 'effect/SchemaAST'
import * as SchemaAST from 'effect/SchemaAST'

import { shouldNeverHappen } from '../../mod.ts'

export * from 'effect/Schema'
export * from './debug-diff.ts'

const Schema = Schema_

export type Schema<A, I = unknown, _R = unknown> = Schema_.Schema<A> & {
  readonly Type: A
  readonly Encoded: any
  readonly DecodingServices: any
  readonly EncodingServices: any
}
export namespace Schema {
  export type Schema<A, I = unknown, _R = unknown> = Schema_.Schema<A> & {
    readonly Type: A
    readonly Encoded: any
    readonly DecodingServices: any
    readonly EncodingServices: any
  }
  export type Top = Schema_.Top
  export type All = Schema_.Top
  export type Decoder<A, _R = never> = Schema_.Decoder<A, _R>
  export type Encoder<A, _R = never> = Schema_.Encoder<A, _R>
  export type Any = Schema_.Top
  export type AnyNoContext = Schema_.Top
  export type Type<S> = S extends { readonly Type: infer A } ? A : unknown
  export type Encoded<S> = S extends { readonly Encoded: infer I } ? I : unknown
  export type DecodingServices<S> = S extends { readonly DecodingServices: infer R } ? R : never
  export type EncodingServices<S> = S extends { readonly EncodingServices: infer R } ? R : never
}

export const decodeUnknownResult =
  <S extends Schema.Top>(schema: S) =>
  (input: unknown, options?: ParseOptions): Result.Result<S['Type'], SchemaIssue.Issue> =>
    SchemaParser.decodeUnknownResult(schema as any)(input, options) as Result.Result<S['Type'], SchemaIssue.Issue>

export const decodeUnknownEffect =
  <S extends Schema.Top>(schema: S) =>
  (
    input: unknown,
    options?: ParseOptions,
  ): Effect.Effect<Schema.Type<S>, SchemaIssue.Issue, Schema.DecodingServices<S>> =>
    SchemaParser.decodeUnknownEffect(schema as any)(input, options) as Effect.Effect<
      Schema.Type<S>,
      SchemaIssue.Issue,
      Schema.DecodingServices<S>
    >

export const encodeEffect =
  <S extends Schema.Top>(schema: S) =>
  (
    input: Schema.Type<S>,
    options?: ParseOptions,
  ): Effect.Effect<Schema.Encoded<S>, SchemaIssue.Issue, Schema.EncodingServices<S>> =>
    SchemaParser.encodeEffect(schema as any)(input, options) as Effect.Effect<
      Schema.Encoded<S>,
      SchemaIssue.Issue,
      Schema.EncodingServices<S>
    >

export const encodeSync = <S extends Schema_.Top>(schema: S) => Schema_.encodeSync(schema as any) as any
export const encodeUnknownSync = <S extends Schema_.Top>(schema: S) => Schema_.encodeUnknownSync(schema as any) as any
export const decodeSync = <S extends Schema_.Top>(schema: S) => Schema_.decodeSync(schema as any) as any
export const decodeUnknownSync = <S extends Schema_.Top>(schema: S) => Schema_.decodeUnknownSync(schema as any) as any
export const decodeEffect =
  <S extends Schema_.Top>(schema: S) =>
  (
    input: Schema.Encoded<S>,
    options?: ParseOptions,
  ): Effect.Effect<Schema.Type<S>, SchemaIssue.Issue, Schema.DecodingServices<S>> =>
    SchemaParser.decodeEffect(schema as any)(input, options) as Effect.Effect<
      Schema.Type<S>,
      SchemaIssue.Issue,
      Schema.DecodingServices<S>
    >
export const decodeExit = <S extends Schema_.Top>(schema: S) => SchemaParser.decodeExit(schema as any) as any
export const encodeExit = <S extends Schema_.Top>(schema: S) => SchemaParser.encodeExit(schema as any) as any

export const head = (schema: Schema_.Top) =>
  Schema.decodeTo(
    schema,
    SchemaTransformation.transform({
      decode: (values: readonly unknown[]) => values[0],
      encode: (value: unknown) => [value],
    }) as any,
  )

export type WithResult<A, _I = unknown, E = never, _EI = unknown, R = never> = {
  readonly _tag: string
  readonly __success?: A
  readonly __failure?: E
  readonly __services?: R
}

export const TaggedRequest =
  <Self = never>() =>
  <const Fields extends Schema_.Struct.Fields, Success extends Schema_.Top, Failure extends Schema_.Top>(
    tag: string,
    options: {
      readonly payload: Fields
      readonly success: Success
      readonly failure: Failure
    },
  ): Schema_.Class<
    Self & WithResult<Success['Type'], Success['Encoded'], Failure['Type'], Failure['Encoded']>,
    Schema_.TaggedStruct<string, Fields>,
    {}
  > & {
    readonly success: Success
    readonly failure: Failure
    readonly make: (
      args: Schema_.TaggedStruct<string, Fields>['~type.make.in'],
    ) => Self & WithResult<Success['Type'], Success['Encoded'], Failure['Type'], Failure['Encoded']>
  } => {
    const klass = Schema.TaggedClass<Self>()(tag, options.payload as any) as any
    klass.success = options.success
    klass.failure = options.failure
    klass.make = (args: any) => new klass(args)
    return klass
  }

// NOTE this is a temporary workaround until Effect schema has a better way to hash schemas
// https://github.com/Effect-TS/effect/issues/2719
// TODO remove this once the issue is resolved
export const hash = (schema: Schema.Schema<any>) => {
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
  schema: Schema.Schema<any>,
): ReadonlyArray<SchemaAST.PropertySignature> => {
  const resolvedProperties = getPropertySignatures(Schema.toEncoded(schema).ast)
  if (resolvedProperties.length === 0) return []

  const sourceProperties = getPropertySignatures(schema.ast)
  const shouldPreserveSourceSchemas =
    sourceProperties.length === resolvedProperties.length &&
    sourceProperties.every((sourceProperty) =>
      resolvedProperties.some((resolvedProperty) => resolvedProperty.name === sourceProperty.name),
    )
  const sourcePropertiesByName = shouldPreserveSourceSchemas === true
    ? new Map(sourceProperties.map((property) => [property.name, property]))
    : new Map<PropertyKey, SchemaAST.PropertySignature>()
  const typeProperties = getPropertySignatures(Schema.toType(schema).ast)
  if (typeProperties.length === 0) {
    return resolvedProperties.map((property) => sourcePropertiesByName.get(property.name) ?? property)
  }

  const typePropertiesByName = new Map(typeProperties.map((property) => [property.name, property]))

  return resolvedProperties.map((property) => {
    const sourceProperty = sourcePropertiesByName.get(property.name) ?? property
    const typeProperty = typePropertiesByName.get(property.name)
    const annotations = typeProperty === undefined ? undefined : SchemaAST.resolve(typeProperty.type)
    if (annotations === undefined) return sourceProperty

    return new SchemaAST.PropertySignature(
      sourceProperty.name,
      Schema.make(sourceProperty.type).annotate(annotations).ast,
    )
  })
}

const getPropertySignatures = (ast: SchemaAST.AST): ReadonlyArray<SchemaAST.PropertySignature> => {
  if (SchemaAST.isObjects(ast) === true) return ast.propertySignatures

  if (SchemaAST.isUnion(ast) === false || ast.types.every(SchemaAST.isObjects) === false) return []

  const propertiesByName = new Map<PropertyKey, ReadonlyArray<SchemaAST.PropertySignature>>()
  for (const member of ast.types) {
    if (SchemaAST.isObjects(member) === false) continue
    for (const property of member.propertySignatures) {
      propertiesByName.set(property.name, [...(propertiesByName.get(property.name) ?? []), property])
    }
  }

  return Array.from(propertiesByName, ([name, properties]) => {
    const types = properties.map((property) => property.type)
    const propertyType = types.length === 1 ? types[0]! : new SchemaAST.Union(types, 'anyOf')
    return new SchemaAST.PropertySignature(name, propertyType)
  })
}

/** Objects that can be transferred between contexts (workers, etc.) */
type TransferableObject = ArrayBuffer | MessagePort

export const encodeWithTransferables =
  <S extends Schema.Top>(schema: S, options?: ParseOptions) =>
  (
    a: S['Type'],
    overrideOptions?: ParseOptions,
  ): Effect.Effect<[S['Encoded'], TransferableObject[]], SchemaIssue.Issue, S['EncodingServices']> =>
    Effect.gen(function* () {
      const collector = yield* Transferable.makeCollector

      const encoded = yield* SchemaParser.encodeEffect(schema)(a, overrideOptions ?? options).pipe(
        Effect.provideService(Transferable.Collector, collector),
      )

      return [encoded, collector.readUnsafe() as TransferableObject[]]
    })

export const decodeSyncDebug: <S extends Schema.Decoder<any>>(
  schema: S,
  options?: SchemaAST.ParseOptions,
) => (i: S['Encoded'], overrideOptions?: SchemaAST.ParseOptions) => S['Type'] =
  (schema, options) => (input, overrideOptions) => {
  try {
    return Schema.decodeSync(schema)(input, overrideOptions ?? options)
  } catch (error) {
    return shouldNeverHappen(`decodeSyncDebug failed:`, error)
  }
}

export const encodeSyncDebug: <S extends Schema.Encoder<any>>(
  schema: S,
  options?: SchemaAST.ParseOptions,
) => (a: S['Type'], overrideOptions?: SchemaAST.ParseOptions) => S['Encoded'] =
  (schema, options) => (input, overrideOptions) => {
  try {
    return Schema.encodeSync(schema)(input, overrideOptions ?? options)
  } catch (error) {
    return shouldNeverHappen(`encodeSyncDebug failed:`, error)
  }
}

export const swap = <S extends Schema.Top>(schema: S): Schema.Schema<S['Encoded']> =>
  Schema.flip(schema) as unknown as Schema.Schema<S['Encoded']>

export const Base64FromUint8Array = swap(Schema.Uint8ArrayFromBase64)

export const DateFromNumber = Schema.Number.pipe(
  Schema.decodeTo(
    Schema.Date,
    SchemaTransformation.transform({
      decode: (value) => new Date(value),
      encode: (value) => value.getTime(),
    }),
  ),
)

export interface JsonArray extends ReadonlyArray<JsonValue> {}
export interface JsonObject {
  [key: string]: JsonValue
}
export type JsonValue = string | number | boolean | null | JsonObject | JsonArray

export const JsonValue: Schema.Schema<JsonValue> = Schema.Union([
  Schema.String,
  Schema.Number,
  Schema.Boolean,
  Schema.Null,
  Schema.Array(Schema.suspend(() => JsonValue)),
  Schema.Record(Schema.String, Schema.suspend(() => JsonValue)),
]).annotate({ identifier: 'JsonValue' })
