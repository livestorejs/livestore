import { Effect, Hash, Schema } from 'effect'
import type { ParseOptions } from 'effect/SchemaAST'
import * as SchemaAST from 'effect/SchemaAST'
import { Transferable } from 'effect/unstable/workers'

import { shouldNeverHappen } from '../../misc.ts'

export * from 'effect/Schema'
export * from './debug-diff.ts'

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
  return SchemaAST.isObjects(resolvedAst) ? resolvedAst.propertySignatures : []
}

export const encodeEffectWithTransferables =
  <S extends Schema.Top>(schema: S, options?: ParseOptions) =>
  (
    a: S['Type'],
    overrideOptions?: ParseOptions,
  ): Effect.Effect<[S['Encoded'], globalThis.Transferable[]], Schema.SchemaError, S['EncodingServices']> =>
    Effect.gen(function* () {
      const collector = yield* Transferable.makeCollector

      const encoded = yield* Schema.encodeEffect(schema, options)(a, overrideOptions).pipe(
        Effect.provideService(Transferable.Collector, collector),
      )

      return [encoded, collector.readUnsafe()]
    })

export const decodeSyncDebug =
  <S extends Schema.Decoder<unknown>>(schema: S, options?: SchemaAST.ParseOptions) =>
  (input: S['Encoded'], overrideOptions?: SchemaAST.ParseOptions): S['Type'] => {
    const res = Schema.decodeExit(schema, options)(input, overrideOptions)
    if (res._tag === 'Failure') {
      return shouldNeverHappen(`decodeSyncDebug failed:`, res.cause)
    } else {
      return res.value
    }
  }

export const encodeSyncDebug =
  <S extends Schema.Encoder<unknown>>(schema: S, options?: SchemaAST.ParseOptions) =>
  (input: S['Type'], overrideOptions?: SchemaAST.ParseOptions): S['Encoded'] => {
    const res = Schema.encodeExit(schema, options)(input, overrideOptions)
    if (res._tag === 'Failure') {
      return shouldNeverHappen(`encodeSyncDebug failed:`, res.cause)
    } else {
      return res.value
    }
  }
