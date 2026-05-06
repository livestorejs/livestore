/// <reference lib="dom" />
import {
  Effect,
  Option,
  Schema,
  SchemaIssue,
  SchemaParser,
  SchemaRepresentation,
  SchemaTransformation,
  Struct,
} from '@livestore/utils/effect'

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

const formatSchemaType = (schema: Schema.Top) =>
  SchemaRepresentation.toCodeDocument(
    SchemaRepresentation.toMultiDocument(SchemaRepresentation.fromAST(schema.ast)),
  ).codes[0]?.Type ?? 'unknown'

const BoundArraySchemaFromSelf = <A>(
  item: Schema.Schema<A>,
): Schema.Schema<BoundArray<A>> =>
  Schema.declareConstructor<BoundArray<A>, BoundArray<A>>()(
    [item],
    ([item]) =>
      (input, ast, parseOptions) => {
        if (isBoundArrayLike(input) === true) {
          const elements = SchemaParser.decodeUnknownEffect(Schema.Array(item))([...input], parseOptions)
          return Effect.map(elements, (as): BoundArray<A> => BoundArray.make(getSizeLimit(input), as))
        }
        return Effect.fail(new SchemaIssue.InvalidType(ast, Option.some(input)))
      },
    {
      description: `BoundArray<${formatSchemaType(item)}>`,
      pretty: () => (_: BoundArray<A>) => `BoundArray(${_.length})`,
      arbitrary: () => (fc: any) => fc.anything() as any,
      equivalence: () => {
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

export const BoundArraySchema = <ItemDecoded, ItemEncoded>(elSchema: Schema.Schema<ItemDecoded, ItemEncoded>) =>
  Schema.Struct({
    size: Schema.Number,
    items: Schema.Array(elSchema),
  }).pipe(
    Schema.decodeTo(
      BoundArraySchemaFromSelf(Schema.toType(elSchema)),
      SchemaTransformation.transform({
        encode: (_: BoundArray<ItemDecoded>) => ({ size: _.sizeLimit, items: [..._] }),
        decode: (_: { readonly size: number; readonly items: readonly ItemDecoded[] }) => BoundArray.make(_.size, _.items),
      }) as any,
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
