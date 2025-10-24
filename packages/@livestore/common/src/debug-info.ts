/// <reference lib="dom" />
import { ParseResult, Schema } from '@livestore/utils/effect'

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

const BoundArraySchemaFromSelf = <A, I, R>(
  item: Schema.Schema<A, I, R>,
): Schema.Schema<BoundArray<A>, BoundArray<I>, R> =>
  Schema.declare(
    [item],
    {
      decode: (item) => (input, parseOptions, ast) => {
        if (isBoundArrayLike(input)) {
          const elements = ParseResult.decodeUnknown(Schema.Array(item))([...input], parseOptions)
          return ParseResult.map(elements, (as): BoundArray<A> => BoundArray.make(getSizeLimit(input), as))
        }
        return ParseResult.fail(new ParseResult.Type(ast, input))
      },
      encode: (item) => (input, parseOptions, ast) => {
        if (isBoundArrayLike(input)) {
          const items = [...input]
          const elements = ParseResult.encodeUnknown(Schema.Array(item))(items, parseOptions)
          return ParseResult.map(elements, (is): BoundArray<I> => BoundArray.make(getSizeLimit(input), is))
        }
        return ParseResult.fail(new ParseResult.Type(ast, input))
      },
    },
    {
      description: `BoundArray<${Schema.format(item)}>`,
      pretty: () => (_) => `BoundArray(${_.length})`,
      arbitrary: () => (fc) => fc.anything() as any,
      equivalence: () => {
        const elementEquivalence = Schema.equivalence(item)
        return (a: unknown, b: unknown) => {
          if (a === b) {
            return true
          }
            if (!isBoundArrayLike(a) || !isBoundArrayLike(b)) {
              return false
            }
            if (getSizeLimit(a) !== getSizeLimit(b) || a.length !== b.length) {
              return false
            }
          const itemsA = [...a]
          const itemsB = [...b]
          for (let i = 0; i < itemsA.length; i++) {
            if (!elementEquivalence(itemsA[i] as any, itemsB[i] as any)) {
              return false
            }
          }
          return true
        }
      },
    },
  )

export const BoundArraySchema = <ItemDecoded, ItemEncoded>(elSchema: Schema.Schema<ItemDecoded, ItemEncoded>) =>
  Schema.transform(
    Schema.Struct({
      size: Schema.Number,
      items: Schema.Array(elSchema),
    }),
    BoundArraySchemaFromSelf(Schema.typeSchema(elSchema)),
    {
      encode: (_) => ({ size: _.sizeLimit, items: [..._] }),
      decode: (_) => BoundArray.make(_.size, _.items),
    },
  )

export const DebugInfo = Schema.Struct({
  slowQueries: BoundArraySchema(SlowQueryInfo),
  queryFrameDuration: Schema.Number,
  queryFrameCount: Schema.Number,
  events: BoundArraySchema(Schema.Tuple(Schema.String, Schema.Any)),
})

export type DebugInfo = typeof DebugInfo.Type

export const MutableDebugInfo = Schema.mutable(DebugInfo)
export type MutableDebugInfo = typeof MutableDebugInfo.Type
