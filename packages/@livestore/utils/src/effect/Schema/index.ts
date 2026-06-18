import { Effect, Hash, ParseResult, Result, Schema } from 'effect'
import type { ParseOptions } from 'effect/SchemaAST'
import * as SchemaAST from 'effect/SchemaAST'
import { Transferable } from 'effect/unstable/workers'

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

const resolveStructAst = (ast: SchemaAST.AST): SchemaAST.AST => {
  if (SchemaAST.isTransformation(ast) === true) {
    return resolveStructAst(ast.from)
  }

  return ast
}

export const getResolvedPropertySignatures = (
  schema: Schema.Top,
): ReadonlyArray<SchemaAST.PropertySignature> => {
  const resolvedAst = resolveStructAst(schema.ast)
  return SchemaAST.getPropertySignatures(resolvedAst)
}

/** Objects that can be transferred between contexts (workers, etc.) */
type TransferableObject = ArrayBuffer | MessagePort

export const encodeWithTransferables =
  <A, I, R>(schema: Schema.Schema<A, I, R>, options?: ParseOptions) =>
  (a: A, overrideOptions?: ParseOptions): Effect.Effect<[I, TransferableObject[]], Schema.SchemaError, R> =>
    Effect.gen(function* () {
      const collector = yield* Transferable.makeCollector

      const encoded: I = yield* Schema.encodeEffect(schema, options)(a, overrideOptions).pipe(
        Effect.provideService(Transferable.Collector, collector),
      )

      return [encoded, collector.readUnsafe() as TransferableObject[]]
    })

export const decodeSyncDebug: <A, I>(
  schema: Schema.Schema<A, I>,
  options?: SchemaAST.ParseOptions,
) => (i: I, overrideOptions?: SchemaAST.ParseOptions) => A = (schema, options) => (input, overrideOptions) => {
  const res = Schema.decodeExit(schema, options)(input, overrideOptions)
  if (Result.isFailure(res)) {
    return shouldNeverHappen(`decodeSyncDebug failed:`, res.failure)
  } else {
    return res.success
  }
}

export const encodeSyncDebug: <A, I>(
  schema: Schema.Schema<A, I>,
  options?: SchemaAST.ParseOptions,
) => (a: A, overrideOptions?: SchemaAST.ParseOptions) => I = (schema, options) => (input, overrideOptions) => {
  const res = Schema.encodeExit(schema, options)(input, overrideOptions)
  if (Result.isFailure(res)) {
    return shouldNeverHappen(`encodeSyncDebug failed:`, res.failure)
  } else {
    return res.success
  }
}

export const swap = <A, I, R>(schema: Schema.Schema<A, I, R>): Schema.Schema<I, A, R> =>
  Schema.transformOrFail(Schema.toType(schema), Schema.toEncoded(schema), {
    decode: ParseResult.encode(schema),
    encode: ParseResult.decode(schema),
  })

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
  Schema.Record(
    Schema.String,
    Schema.suspend(() => JsonValue),
  ),
]).annotate({ identifier: 'JsonValue' })
