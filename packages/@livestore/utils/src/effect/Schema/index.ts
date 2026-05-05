import { Transferable } from 'effect/unstable/workers'
import { Effect, Hash, Schema, SchemaIssue, SchemaParser } from 'effect'
import type { ParseOptions } from 'effect/SchemaAST'
import * as SchemaAST from 'effect/SchemaAST'

import { shouldNeverHappen } from '../../mod.ts'

export * from 'effect/Schema'
export * from './debug-diff.ts'

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
  schema: Schema.Schema.AnyNoContext,
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
  <A, I, R>(schema: Schema.Schema<A, I, R>, options?: ParseOptions) =>
  (a: A, overrideOptions?: ParseOptions): Effect.Effect<[I, TransferableObject[]], SchemaIssue.Issue, R> =>
    Effect.gen(function* () {
      const collector = yield* Transferable.makeCollector

      const encoded: I = yield* SchemaParser.encodeEffect(schema)(a, overrideOptions ?? options).pipe(
        Effect.provideService(Transferable.Collector, collector),
      )

      return [encoded, collector.readUnsafe() as TransferableObject[]]
    })

export const decodeSyncDebug: <A, I>(
  schema: Schema.Schema<A, I>,
  options?: SchemaAST.ParseOptions,
) => (i: I, overrideOptions?: SchemaAST.ParseOptions) => A = (schema, options) => (input, overrideOptions) => {
  try {
    return Schema.decodeSync(schema, options)(input, overrideOptions)
  } catch (error) {
    return shouldNeverHappen(`decodeSyncDebug failed:`, error)
  }
}

export const encodeSyncDebug: <A, I>(
  schema: Schema.Schema<A, I>,
  options?: SchemaAST.ParseOptions,
) => (a: A, overrideOptions?: SchemaAST.ParseOptions) => I = (schema, options) => (input, overrideOptions) => {
  try {
    return Schema.encodeSync(schema, options)(input, overrideOptions)
  } catch (error) {
    return shouldNeverHappen(`encodeSyncDebug failed:`, error)
  }
}

export const swap = <A, I, R>(schema: Schema.Schema<A, I, R>): Schema.Schema<I, A, R> =>
  Schema.flip(schema) as Schema.Schema<I, A, R>

export const Base64FromUint8Array: Schema.Schema<string, Uint8Array> = swap(Schema.Uint8ArrayFromBase64)

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
