/// <reference lib="dom" />
import { Effect, Option, Schema, SchemaIssue, SchemaParser, SchemaTransformation } from 'effect'

import { BoundArray } from './bounded-collections.ts'
import { PreparedBindValues } from './util.ts'

export type SlowQueryInfo = {
  queryStr: string
  bindValues: PreparedBindValues | undefined
  durationMs: number
  rowsCount: number | undefined
  queriedTables: Set<string>
  startTimePerfNow: DOMHighResTimeStamp
}

export const SlowQueryInfo = Schema.Struct({
  queryStr: Schema.String,
  bindValues: Schema.UndefinedOr(PreparedBindValues),
  durationMs: Schema.Number,
  rowsCount: Schema.UndefinedOr(Schema.Number),
  queriedTables: Schema.ReadonlySet(Schema.String),
  startTimePerfNow: Schema.Number,
})

const getSizeLimit = (value: unknown): number =>
  typeof (value as { sizeLimit?: number }).sizeLimit === 'number'
    ? (value as { sizeLimit: number }).sizeLimit
    : Number.POSITIVE_INFINITY

const isBoundArrayLike = (value: unknown): value is BoundArray<unknown> =>
  value instanceof BoundArray ||
  (value !== null && typeof value === 'object' && typeof (value as { sizeLimit?: number }).sizeLimit === 'number')

const BoundArraySchemaFromSelf = <S extends Schema.Top>(
  item: S,
): Schema.Codec<BoundArray<S['Type']>, BoundArray<S['Encoded']>, S['DecodingServices'], S['EncodingServices']> =>
  Schema.declareConstructor<BoundArray<S['Type']>, BoundArray<S['Encoded']>>()(
    [item],
    ([itemCodec]) =>
      (input, ast, parseOptions) => {
        if (isBoundArrayLike(input) === true) {
          return SchemaParser.decodeUnknownEffect(Schema.Array(itemCodec))([...input], parseOptions).pipe(
            Effect.map((items): BoundArray<S['Type']> => BoundArray.make(getSizeLimit(input), items)),
          )
        }
        return Effect.fail(new SchemaIssue.InvalidType(ast, Option.some(input)))
      },
    {
      expected: `BoundArray<${String(item.ast)}>`,
      toFormatter: () => (_) => `BoundArray(${_.length})`,
      toEquivalence: () => {
        const elementEquivalence = Schema.toEquivalence(item)
        return (a: unknown, b: unknown) => {
          if (a === b) {
            return true
          }
          if (isBoundArrayLike(a) === false || isBoundArrayLike(b) === false) {
            return false
          }
          if (getSizeLimit(a) !== getSizeLimit(b) || a.length !== b.length) {
            return false
          }
          const itemsA = [...a]
          const itemsB = [...b]
          for (let i = 0; i < itemsA.length; i++) {
            if (elementEquivalence(itemsA[i] as any, itemsB[i] as any) === false) {
              return false
            }
          }
          return true
        }
      },
    },
  )

export const BoundArraySchema = <S extends Schema.Top>(elSchema: S) =>
  Schema.Struct({
    size: Schema.Number,
    items: Schema.Array(elSchema),
  }).pipe(
    Schema.decodeTo(
      BoundArraySchemaFromSelf(Schema.toType(elSchema)),
      SchemaTransformation.transform({
        encode: (_): { readonly size: number; readonly items: ReadonlyArray<S['Type']> } => ({
          size: _.sizeLimit,
          items: [..._],
        }),
        decode: (_) => BoundArray.make(_.size, _.items),
      }),
    ),
  )

export const DebugInfo = Schema.Struct({
  slowQueries: BoundArraySchema(SlowQueryInfo),
  queryFrameDuration: Schema.Number,
  queryFrameCount: Schema.Number,
  events: BoundArraySchema(Schema.Tuple([Schema.String, Schema.Any])),
})

export type DebugInfo = typeof DebugInfo.Type

export type MutableDebugInfo = { -readonly [K in keyof DebugInfo]: DebugInfo[K] }
