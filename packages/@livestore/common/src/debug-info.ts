/// <reference lib="dom" />
import { Schema, SchemaGetter, Struct } from '@livestore/utils/effect'

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

const isBoundArrayLike = <A>(value: unknown): value is BoundArray<A> =>
  value instanceof BoundArray

const BoundArraySchemaFromSelf = <A, I, RD, RE>(
  item: Schema.Codec<A, I, RD, RE>,
): Schema.Codec<BoundArray<A>, BoundArray<A>> =>
  Schema.declare<BoundArray<A>>(
    isBoundArrayLike,
    {
      identifier: 'BoundArray',
      expected: 'BoundArray',
      description: 'Bounded array',
      toFormatter: () => (_) => `BoundArray(${_.length})`,
      toArbitrary: () => (fc) => {
        const itemArbitrary = Schema.toArbitraryLazy(item)(fc)
        return fc.integer({ min: 0, max: 100 }).chain((sizeLimit) =>
          fc.array(itemArbitrary, { maxLength: sizeLimit }).map((items) => BoundArray.make(sizeLimit, items)),
        )
      },
      toEquivalence: () => {
        const elementEquivalence = Schema.toEquivalence(item)
        return (a, b) => {
          if (a === b) {
            return true
          }
          if (isBoundArrayLike(a) === false || isBoundArrayLike(b) === false) {
            return false
          }
          if (a.sizeLimit !== b.sizeLimit || a.length !== b.length) {
            return false
          }
          const itemsA = [...a]
          const itemsB = [...b]
          for (let i = 0; i < itemsA.length; i++) {
            if (elementEquivalence(itemsA[i]!, itemsB[i]!) === false) {
              return false
            }
          }
          return true
        }
      },
    },
  )

export const BoundArraySchema = <ItemDecoded, ItemEncoded>(elSchema: Schema.Codec<ItemDecoded, ItemEncoded>) =>
  Schema.Struct({
    size: Schema.Number,
    items: Schema.Array(elSchema),
  }).pipe(
    Schema.decodeTo(
      BoundArraySchemaFromSelf(Schema.toType(elSchema)),
      {
        decode: SchemaGetter.transform((_) => BoundArray.make(_.size, _.items)),
        encode: SchemaGetter.transform((_) => ({ size: _.sizeLimit, items: [..._] })),
      },
    ),
  )

export const DebugInfo = Schema.Struct({
  slowQueries: BoundArraySchema(SlowQueryInfo),
  queryFrameDuration: Schema.Number,
  queryFrameCount: Schema.Number,
  events: BoundArraySchema(Schema.Tuple([Schema.String, Schema.Any])),
})

export type DebugInfo = typeof DebugInfo.Type

export const MutableDebugInfo = DebugInfo.mapFields(Struct.map(Schema.mutableKey))
export type MutableDebugInfo = typeof MutableDebugInfo.Type
