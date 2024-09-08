import { Transferable } from '@effect/platform'
import { ParseResult, Schema } from '@effect/schema'
import type { ParseOptions } from '@effect/schema/AST'
import type { ParseError } from '@effect/schema/ParseResult'
import { Effect, Hash } from 'effect'

export * from '@effect/schema/Schema'
export * from './debug-diff.js'
export * from './msgpack.js'

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

export const encodeWithTransferables =
  <A, I, R>(schema: Schema.Schema<A, I, R>, options?: ParseOptions | undefined) =>
  (a: A, overrideOptions?: ParseOptions | undefined): Effect.Effect<[I, Transferable[]], ParseError, R> =>
    Effect.gen(function* () {
      const collector = yield* Transferable.makeCollector

      const encoded: I = yield* Schema.encode(schema, options)(a, overrideOptions).pipe(
        Effect.provideService(Transferable.Collector, collector),
      )

      return [encoded, collector.unsafeRead() as Transferable[]]
    })

export const swap = <A, I, R>(schema: Schema.Schema<A, I, R>): Schema.Schema<I, A, R> =>
  Schema.transformOrFail(Schema.typeSchema(schema), Schema.encodedSchema(schema), {
    decode: ParseResult.encode(schema),
    encode: ParseResult.decode(schema),
  })

export const Base64FromUint8Array: Schema.Schema<string, Uint8Array> = swap(Schema.Uint8ArrayFromBase64)

export interface JsonArray extends ReadonlyArray<JsonValue> {}
export interface JsonObject {
  [key: string]: JsonValue
}
export type JsonValue = string | number | boolean | null | JsonObject | JsonArray

export const JsonValue: Schema.Schema<JsonValue> = Schema.Union(
  Schema.String,
  Schema.Number,
  Schema.Boolean,
  Schema.Null,
  Schema.Array(Schema.suspend(() => JsonValue)),
  Schema.Record({ key: Schema.String, value: Schema.suspend(() => JsonValue) }),
)
