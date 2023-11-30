import * as Schema from '@effect/schema/Schema'

export type FieldType<TColumnType extends FieldColumnType, TEncoded, TDecoded> = {
  columnType: TColumnType
  /** Maps from the persisted DB column type to the runtime value type (and vice versa) */
  codec: Schema.Schema<TEncoded, TDecoded>
}

export type FieldColumnType = 'text' | 'integer' | 'real' | 'blob'

export type FieldTypeJson<TDecoded> = FieldType<'text', string, TDecoded>
export type FieldTypeText<TEncoded extends string, TDecoded extends string> = FieldType<'text', TEncoded, TDecoded>
export type FieldTypeInteger<TEncoded extends number, TDecoded extends number> = FieldType<
  'integer',
  TEncoded,
  TDecoded
>
export type FieldTypeReal<TEncoded extends number, TDecoded extends number> = FieldType<'real', TEncoded, TDecoded>
export type FieldTypeBlob<TDecoded> = FieldType<'blob', Uint8Array, TDecoded>

/** Number corresponds with MS since epoch */
export type FieldTypeDateTime = FieldType<'integer', number, Date>
export type FieldTypeBoolean = FieldType<'integer', number, boolean>

export const text = <TEncoded extends string, TDecoded extends string>(
  codec: Schema.Schema<TEncoded, TDecoded> = Schema.string as unknown as Schema.Schema<TEncoded, TDecoded>,
): FieldTypeText<TEncoded, TDecoded> => ({
  columnType: 'text',
  codec,
})

export const integer = <TEncoded extends number, TDecoded extends number>(
  codec: Schema.Schema<TEncoded, TDecoded> = Schema.int()(Schema.number) as unknown as Schema.Schema<
    TEncoded,
    TDecoded
  >,
): FieldTypeInteger<TEncoded, TDecoded> => ({
  columnType: 'integer',
  codec,
})

export const real = <TEncoded extends number, TDecoded extends number>(
  codec: Schema.Schema<TEncoded, TDecoded> = Schema.number as unknown as Schema.Schema<TEncoded, TDecoded>,
): FieldTypeReal<TEncoded, TDecoded> => ({
  columnType: 'real',
  codec,
})

export const blob = (): FieldTypeBlob<Uint8Array> => ({
  columnType: 'blob',
  codec: Schema.Uint8ArrayFromSelf,
})

// Wrappers over the above

export const blobWithCodec = <TDecoded>(codec: Schema.Schema<Uint8Array, TDecoded>): FieldTypeBlob<TDecoded> => ({
  columnType: 'blob',
  codec,
})

export const boolean = (): FieldTypeBoolean => ({
  columnType: 'integer',
  codec: Schema.transform(
    Schema.number,
    Schema.boolean,
    (_) => _ === 1,
    (_) => (_ ? 1 : 0),
  ),
})

export const jsonUnsafe = <T>(): FieldTypeJson<T> => {
  const codec = Schema.transform(
    Schema.string,
    Schema.any as Schema.Schema<T, T>,
    (str) => JSON.parse(str),
    (json) => JSON.stringify(json),
  )

  return { columnType: 'text', codec }
}

export const json = <From, To>(toSchema: Schema.Schema<From, To>): FieldTypeJson<To> => {
  const codec = Schema.transform(
    Schema.string,
    toSchema,
    (str) => JSON.parse(str),
    (json) => JSON.stringify(json),
  )

  return { columnType: 'text', codec }
}

export const datetime = (): FieldTypeDateTime => ({
  columnType: 'integer',
  codec: Schema.transform(
    Schema.number,
    Schema.DateFromSelf,
    (_) => new Date(_),
    (_) => _.getTime(),
  ),
})
