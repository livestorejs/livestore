import { casesHandled, textEncodeToArrayBuffer } from '@livestore/utils'
import { Schema, SchemaAST, SchemaRepresentation } from '@livestore/utils/effect'

import { isDefaultThunk, isSqlDefaultValue } from '../dsl/field-defs.ts'
import { hasJsonStringEncoding } from '../has-json-string-encoding.ts'
import { digestToFingerprint } from './fingerprint-digest.ts'
import type { Column, ColumnType, DbSchema, Index, Table } from './sqlite.ts'

type FingerprintInput = Table | DbSchema

export const fingerprint = (input: FingerprintInput): string => digestToFingerprint(toCanonicalBytes(input))

type CanonicalValue = Schema.Json

type SchemaDescriptorCache = WeakMap<Schema.Top, CanonicalValue>

const domain = 'livestore/state-storage-fingerprint'

const toCanonicalBytes = (input: FingerprintInput): Uint8Array<ArrayBuffer> =>
  textEncodeToArrayBuffer(JSON.stringify(toRootDescriptor(input)))

const toRootDescriptor = (input: FingerprintInput): CanonicalValue => {
  // Limit schema memoization to one fingerprint operation so descriptors remain collectible.
  const cache: SchemaDescriptorCache = new WeakMap()
  return [domain, toDescriptor(input, cache)]
}

const toDescriptor = (input: FingerprintInput, cache: SchemaDescriptorCache): CanonicalValue => {
  switch (input._tag) {
    case 'table':
      return tableDescriptor(input, cache)
    case 'dbSchema':
      return dbSchemaDescriptor(input, cache)
    default:
      return casesHandled(input)
  }
}

const columnDescriptor = (column: Column, cache: SchemaDescriptorCache): CanonicalValue => {
  const {
    _tag: _tagIgnored,
    name,
    type,
    primaryKey,
    nullable,
    autoIncrement,
    default: defaultValue,
    schema,
    ...unhandled
  } = column
  assertNoUnhandledKeys(unhandled)

  return [
    'column',
    name,
    columnTypeDescriptor(type),
    primaryKey,
    nullable,
    autoIncrement,
    defaultDescriptor(defaultValue, schema),
    hasJsonStringEncoding(schema.ast) === true ? schemaDescriptor(schema, cache) : null,
  ]
}

const columnTypeDescriptor = (type: ColumnType.ColumnType): string => {
  const { _tag, ...unhandled } = type
  assertNoUnhandledKeys(unhandled)
  switch (_tag) {
    case 'text':
    case 'null':
    case 'real':
    case 'integer':
    case 'blob':
      return _tag
    default:
      return casesHandled(_tag)
  }
}

const indexDescriptor = (index: Index): CanonicalValue => {
  const { _tag: _tagIgnored, name, unique, primaryKey, columns, ...unhandled } = index
  assertNoUnhandledKeys(unhandled)
  return ['index', name ?? null, unique ?? false, primaryKey ?? false, columns]
}

const tableDescriptor = (table: Table, cache: SchemaDescriptorCache): CanonicalValue => {
  const { _tag: _tagIgnored, name, columns, indexes, ...unhandled } = table
  assertNoUnhandledKeys(unhandled)
  return [
    'table',
    name,
    columns.map((column) => columnDescriptor(column, cache)),
    sortCanonicalValues(indexes.map(indexDescriptor)),
  ]
}

const dbSchemaDescriptor = (dbSchema: DbSchema, cache: SchemaDescriptorCache): CanonicalValue => {
  const { _tag: _tagIgnored, tables, ...unhandled } = dbSchema
  assertNoUnhandledKeys(unhandled)
  return ['database', sortByCanonicalKey(tables, (table) => table.name).map((table) => tableDescriptor(table, cache))]
}

const defaultDescriptor = (value: Column['default'], schema: Column['schema']): CanonicalValue => {
  if (value._tag === 'None') return ['none']
  if (isDefaultThunk(value.value) === true) return ['runtime-default']
  if (value.value === null) return ['value', null]
  if (isSqlDefaultValue(value.value) === true) return ['sql', value.value.sql]

  return ['value', canonicalValue(Schema.encodeSync(schema)(value.value))]
}

const schemaDescriptor = (schema: Schema.Top, cache: SchemaDescriptorCache): CanonicalValue => {
  const cached = cache.get(schema)
  if (cached !== undefined) return cached

  // Both ends matter: the encoded side describes stored JSON while the type side
  // distinguishes codecs such as DateFromString from an unconstrained string.
  const document = SchemaRepresentation.toRepresentations([schema.ast, SchemaAST.toType(schema.ast)], {
    referencePolicy: () => undefined,
  })
  const descriptor: CanonicalValue = ['schema', schemaRepresentationDescriptor(document)]
  cache.set(schema, descriptor)
  return descriptor
}

const schemaRepresentationDescriptor = (value: unknown, parentKey?: string): CanonicalValue => {
  // Representation payloads are application-owned JSON. Keys such as `annotations`
  // inside them are data, not Effect metadata.
  if (parentKey === 'payload') return canonicalValue(value)

  if (Array.isArray(value) === true) return value.map((item) => schemaRepresentationDescriptor(item))

  if (value !== null && typeof value === 'object' && value instanceof Uint8Array === false) {
    const entries = sortByCanonicalKey(
      Object.entries(value).filter(([key]) => effectIgnoredFields.has(key) === false),
      ([key]) => key,
    ).map(([key, entryValue]) => [key, schemaRepresentationDescriptor(entryValue, key)] as const)
    return Object.fromEntries(entries)
  }

  return canonicalValue(value)
}

const effectIgnoredFields = new Set(['annotations', 'isMutable'])

const canonicalValue = (value: unknown): CanonicalValue => {
  if (Array.isArray(value) === true) return value.map(canonicalValue)

  if (value !== null && typeof value === 'object' && value instanceof Uint8Array === false) {
    const entries = sortByCanonicalKey(Object.entries(value), ([key]) => key).map(
      ([key, entryValue]) => [key, canonicalValue(entryValue)] as const,
    )
    return Object.fromEntries(entries)
  }

  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value

  if (typeof value === 'number') {
    if (Number.isNaN(value) === true) return specialValue('number', 'NaN')
    if (value === Number.POSITIVE_INFINITY) return specialValue('number', 'Infinity')
    if (value === Number.NEGATIVE_INFINITY) return specialValue('number', '-Infinity')
    if (Object.is(value, -0) === true) return specialValue('number', '-0')
    return value
  }

  if (typeof value === 'bigint') return specialValue('bigint', value.toString(10))
  if (value === undefined) return specialValue('undefined')

  if (typeof value === 'symbol') {
    const symbolKey = Symbol.keyFor(value)
    if (symbolKey === undefined) throw new Error('Local symbols cannot be represented in a persistent fingerprint')
    return specialValue('symbol', symbolKey)
  }

  if (typeof value === 'function') throw new Error('Functions cannot be represented in a persistent fingerprint')
  if (value instanceof Uint8Array) return specialValue('bytes', bytesToHex(value))

  throw new Error('Unsupported canonical value')
}

const specialValue = (type: string, value?: string): CanonicalValue => ({
  $livestore$type: value === undefined ? [type] : [type, value],
})

const bytesToHex = (bytes: Uint8Array): string => {
  let output = ''
  for (const byte of bytes) output += byte.toString(16).padStart(2, '0')
  return output
}

/** Avoid repeatedly serializing deep descriptors from inside an O(n log n) sort comparator. */
const sortCanonicalValues = (values: ReadonlyArray<CanonicalValue>): ReadonlyArray<CanonicalValue> =>
  values
    .map((value) => ({ value, key: JSON.stringify(value) }))
    .toSorted((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0))
    .map(({ value }) => value)

const sortByCanonicalKey = <A>(values: ReadonlyArray<A>, key: (value: A) => CanonicalValue): ReadonlyArray<A> =>
  values
    .map((value) => ({ value, key: JSON.stringify(key(value)) }))
    .toSorted((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0))
    .map(({ value }) => value)

const assertNoUnhandledKeys = (_unhandled: Record<PropertyKey, never>): void => {}
