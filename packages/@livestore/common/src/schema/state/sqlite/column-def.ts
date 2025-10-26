import { shouldNeverHappen } from '@livestore/utils'
import { Option, Schema, SchemaAST } from '@livestore/utils/effect'

import { AutoIncrement, ColumnType, Default, PrimaryKeyId, Unique } from './column-annotations.ts'
import { SqliteDsl } from './db-schema/mod.ts'

/**
 * Maps a schema to a SQLite column definition, respecting column annotations.
 *
 * Note: When used with schema-based table definitions, optional fields (| undefined)
 * are transformed to nullable fields (| null) to match SQLite's NULL semantics.
 * Fields with both null and undefined will emit a warning as this is a lossy conversion.
 */
export const getColumnDefForSchema = (
  schema: Schema.Schema.AnyNoContext,
  propertySignature?: SchemaAST.PropertySignature,
  forceNullable = false,
): SqliteDsl.ColumnDefinition.Any => {
  const ast = schema.ast

  // Extract annotations
  const getAnnotation = <T>(annotationId: symbol): Option.Option<T> =>
    propertySignature
      ? hasPropertyAnnotation<T>(propertySignature, annotationId)
      : SchemaAST.getAnnotation<T>(annotationId)(ast)

  const columnType = SchemaAST.getAnnotation<SqliteDsl.FieldColumnType>(ColumnType)(ast)

  // Check if schema has null (e.g., Schema.NullOr) or undefined or if it's forced nullable (optional field)
  const isNullable = forceNullable || hasNull(ast) || hasUndefined(ast)

  // Get base column definition with nullable flag
  const baseColumn = Option.isSome(columnType)
    ? getColumnForType(columnType.value, isNullable)
    : getColumnForSchema(schema, isNullable)

  // Apply annotations
  const primaryKey = getAnnotation<boolean>(PrimaryKeyId).pipe(Option.getOrElse(() => false))
  const autoIncrement = getAnnotation<boolean>(AutoIncrement).pipe(Option.getOrElse(() => false))
  const defaultValue = getAnnotation<unknown>(Default)

  return {
    ...baseColumn,
    ...(primaryKey && { primaryKey: true }),
    ...(autoIncrement && { autoIncrement: true }),
    ...(Option.isSome(defaultValue) && { default: Option.some(defaultValue.value) }),
  }
}

const hasPropertyAnnotation = <T>(
  propertySignature: SchemaAST.PropertySignature,
  annotationId: symbol,
): Option.Option<T> => {
  if ('annotations' in propertySignature && propertySignature.annotations) {
    const annotation = SchemaAST.getAnnotation<T>(annotationId)(propertySignature as any)
    if (Option.isSome(annotation)) return annotation
  }
  return SchemaAST.getAnnotation<T>(annotationId)(propertySignature.type)
}

/**
 * Maps schema property signatures to SQLite column definitions.
 * Optional fields (| undefined) become nullable columns (| null).
 */
export const schemaFieldsToColumns = (
  propertySignatures: ReadonlyArray<SchemaAST.PropertySignature>,
): { columns: SqliteDsl.Columns; uniqueColumns: string[] } => {
  const columns: SqliteDsl.Columns = {}
  const uniqueColumns: string[] = []

  for (const prop of propertySignatures) {
    if (typeof prop.name !== 'string') continue

    const fieldSchema = Schema.make(prop.type)

    // Warn about lossy conversion for fields with both null and undefined
    if (prop.isOptional) {
      const { hasNull, hasUndefined } = checkNullUndefined(fieldSchema.ast)
      if (hasNull && hasUndefined) {
        console.warn(`Field '${prop.name}' has both null and undefined - treating | undefined as | null`)
      }
    }

    // Get column definition - pass nullable flag for optional fields
    const columnDef = getColumnDefForSchema(fieldSchema, prop, prop.isOptional)

    // Check for primary key and unique annotations
    const hasPrimaryKey = hasPropertyAnnotation<boolean>(prop, PrimaryKeyId).pipe(Option.getOrElse(() => false))
    const hasUnique = hasPropertyAnnotation<boolean>(prop, Unique).pipe(Option.getOrElse(() => false))

    // Build final column
    columns[prop.name] = {
      ...columnDef,
      ...(hasPrimaryKey && { primaryKey: true }),
    }

    // Validate primary key + nullable
    const column = columns[prop.name]
    if (column?.primaryKey && column.nullable) {
      throw new Error('Primary key columns cannot be nullable')
    }

    if (hasUnique) uniqueColumns.push(prop.name)
  }

  return { columns, uniqueColumns }
}

const checkNullUndefined = (ast: SchemaAST.AST): { hasNull: boolean; hasUndefined: boolean } => {
  let hasNull = false
  let hasUndefined = false

  const visit = (type: SchemaAST.AST): void => {
    if (SchemaAST.isUndefinedKeyword(type)) hasUndefined = true
    else if (SchemaAST.isLiteral(type) && type.literal === null) hasNull = true
    else if (SchemaAST.isUnion(type)) type.types.forEach(visit)
  }

  visit(ast)
  return { hasNull, hasUndefined }
}

const hasNull = (ast: SchemaAST.AST): boolean => {
  if (SchemaAST.isLiteral(ast) && ast.literal === null) return true
  if (SchemaAST.isUnion(ast)) {
    return ast.types.some((type) => hasNull(type))
  }
  return false
}

const hasUndefined = (ast: SchemaAST.AST): boolean => {
  if (SchemaAST.isUndefinedKeyword(ast)) return true
  if (SchemaAST.isUnion(ast)) {
    return ast.types.some((type) => hasUndefined(type))
  }
  return false
}

const getColumnForType = (columnType: string, nullable = false): SqliteDsl.ColumnDefinition.Any => {
  switch (columnType) {
    case 'text':
      return SqliteDsl.text({ nullable })
    case 'integer':
      return SqliteDsl.integer({ nullable })
    case 'real':
      return SqliteDsl.real({ nullable })
    case 'blob':
      return SqliteDsl.blob({ nullable })
    default:
      return shouldNeverHappen(`Unsupported column type: ${columnType}`)
  }
}

const getColumnForSchema = (schema: Schema.Schema.AnyNoContext, nullable = false): SqliteDsl.ColumnDefinition.Any => {
  const ast = schema.ast
  // Strip nullable wrapper to get core type
  const coreAst = stripNullable(ast)
  const coreSchema = stripNullable(ast) === ast ? schema : Schema.make(coreAst)

  // Special case: Boolean is transformed to integer in SQLite
  if (SchemaAST.isBooleanKeyword(coreAst)) {
    return SqliteDsl.boolean({ nullable })
  }

  // Get the encoded AST - what actually gets stored in SQLite
  const encodedAst = Schema.encodedSchema(coreSchema).ast

  // Check if the encoded type matches SQLite native types
  if (SchemaAST.isStringKeyword(encodedAst)) {
    return SqliteDsl.text({ schema: coreSchema, nullable })
  }

  if (SchemaAST.isNumberKeyword(encodedAst)) {
    // Special cases for integer columns
    const id = SchemaAST.getIdentifierAnnotation(coreAst).pipe(Option.getOrElse(() => ''))
    if (id === 'Int' || id === 'DateFromNumber') {
      return SqliteDsl.integer({ schema: coreSchema, nullable })
    }
    return SqliteDsl.real({ schema: coreSchema, nullable })
  }

  // Literals based on their type
  if (SchemaAST.isLiteral(coreAst)) {
    const value = coreAst.literal
    if (typeof value === 'boolean') return SqliteDsl.boolean({ nullable })
  }

  if (isLiteralUnionOf(coreAst, (value): value is string => typeof value === 'string')) {
    return SqliteDsl.text({ schema: coreSchema, nullable })
  }

  // Literals based on their encoded type
  if (SchemaAST.isLiteral(encodedAst)) {
    const value = encodedAst.literal
    if (typeof value === 'string') return SqliteDsl.text({ schema: coreSchema, nullable })
    if (typeof value === 'number') {
      // Check if the original schema is Int
      const id = SchemaAST.getIdentifierAnnotation(coreAst).pipe(Option.getOrElse(() => ''))
      if (id === 'Int') {
        return SqliteDsl.integer({ schema: coreSchema, nullable })
      }
      return SqliteDsl.real({ schema: coreSchema, nullable })
    }
  }

  if (isLiteralUnionOf(encodedAst, (value): value is string => typeof value === 'string')) {
    return SqliteDsl.text({ schema: coreSchema, nullable })
  }

  // Everything else needs JSON encoding
  return SqliteDsl.json({ schema: coreSchema, nullable })
}

const stripNullable = (ast: SchemaAST.AST): SchemaAST.AST => {
  if (!SchemaAST.isUnion(ast)) return ast

  // Filter out null/undefined members while preserving any annotations on the union
  const coreTypes = ast.types.filter(
    (type) => !(SchemaAST.isLiteral(type) && type.literal === null) && !SchemaAST.isUndefinedKeyword(type),
  )

  if (coreTypes.length === 0 || coreTypes.length === ast.types.length) {
    return ast
  }

  if (coreTypes.length === 1) {
    return coreTypes[0]!
  }

  return SchemaAST.Union.make(coreTypes, ast.annotations)
}

const isLiteralUnionOf = <T extends SchemaAST.LiteralValue>(
  ast: SchemaAST.AST,
  predicate: (value: SchemaAST.LiteralValue) => value is T,
): ast is SchemaAST.Union & { types: ReadonlyArray<SchemaAST.Literal & { literal: T }> } =>
  SchemaAST.isUnion(ast) &&
  ast.types.length > 0 &&
  ast.types.every((type) => SchemaAST.isLiteral(type) && predicate(type.literal))
