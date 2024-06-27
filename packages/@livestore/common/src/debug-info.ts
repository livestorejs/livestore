import { ParseResult, Schema } from '@livestore/utils/effect'

import { BoundArray } from './bounded-collections.js'
import { PreparedBindValues } from './util.js'

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

const BoundArraySchemaFromSelf = <A, I, R>(
  item: Schema.Schema<A, I, R>,
): Schema.Schema<BoundArray<A>, BoundArray<I>, R> =>
  Schema.declare(
    [item],
    {
      decode: (item) => (input, parseOptions, ast) => {
        if (input instanceof BoundArray) {
          const elements = ParseResult.decodeUnknown(Schema.Array(item))([...input], parseOptions)
          return ParseResult.map(elements, (as): BoundArray<A> => BoundArray.make(input.sizeLimit, as))
        }
        return ParseResult.fail(new ParseResult.Type(ast, input))
      },
      encode: (item) => (input, parseOptions, ast) => {
        if (input instanceof BoundArray) {
          const elements = ParseResult.encodeUnknown(Schema.Array(item))([...input], parseOptions)
          return ParseResult.map(elements, (is): BoundArray<I> => BoundArray.make(input.sizeLimit, is))
        }
        return ParseResult.fail(new ParseResult.Type(ast, input))
      },
    },
    {
      description: `BoundArray<${Schema.format(item)}>`,
      pretty: () => (_) => `BoundArray(${_.length})`,
      arbitrary: () => (fc) => fc.anything() as any,
      equivalence: () => (a, b) => a === b,
    },
  )

const BoundArraySchema = <ItemDecoded, ItemEncoded>(elSchema: Schema.Schema<ItemDecoded, ItemEncoded>) =>
  Schema.transform(
    Schema.Struct({
      size: Schema.Number,
      items: Schema.Array(elSchema),
    }),
    BoundArraySchemaFromSelf(elSchema as any as Schema.Schema<ItemDecoded>),
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

// export interface DebugInfo {
//   slowQueries: BoundArray<SlowQueryInfo>
//   queryFrameDuration: number
//   queryFrameCount: number
//   events: BoundArray<[queryStr: string, bindValues: Bindable | undefined]>
// }

export type DebugInfo = typeof DebugInfo.Type

export const MutableDebugInfo = Schema.mutable(DebugInfo)
export type MutableDebugInfo = typeof MutableDebugInfo.Type
