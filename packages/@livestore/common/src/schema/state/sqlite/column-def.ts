import { shouldNeverHappen, type Writeable } from '@livestore/utils'
import { Option, Schema, SchemaAST } from '@livestore/utils/effect'

import { AutoIncrement, ColumnType, Default, PrimaryKeyId, Unique } from './column-annotations.ts'
import { SqliteDsl } from './db-schema/mod.ts'

/**
 * Maps a schema to a SQLite column definition, respecting column annotations.
 */
export const getColumnDefForSchema = (
  schema: Schema.Schema.AnyNoContext,
  propertySignature?: SchemaAST.PropertySignature,
): SqliteDsl.ColumnDefinition.Any => {
  const ast = schema.ast

  // 1. Extract annotations
  const getAnnotation = <T>(annotationId: symbol): Option.Option<T> =>
    propertySignature
      ? hasPropertyAnnotation<T>(propertySignature, annotationId)
      : SchemaAST.getAnnotation<T>(annotationId)(ast)

  const annotations = {
    primaryKey: getAnnotation<boolean>(PrimaryKeyId).pipe(Option.getOrElse(() => false)),
    autoIncrement: getAnnotation<boolean>(AutoIncrement).pipe(Option.getOrElse(() => false)),
    defaultValue: getAnnotation<unknown>(Default),
    columnType: SchemaAST.getAnnotation<SqliteDsl.FieldColumnType>(ColumnType)(ast),
  }

  // 2. Resolve the core type and nullable info
  const typeInfo = resolveType(ast)

  // 3. Create column definition based on resolved type
  let columnDef: SqliteDsl.ColumnDefinition.Any

  // Custom column type overrides everything
  if (Option.isSome(annotations.columnType)) {
    columnDef = createColumnFromType(annotations.columnType.value, typeInfo.coreType)
  }
  // Lossy case: both null and undefined need JSON
  else if (typeInfo.hasNull && typeInfo.hasUndefined) {
    columnDef = {
      ...SqliteDsl.text(),
      nullable: true,
      schema: Schema.parseJson(schema),
    }
  }
  // Regular nullable/optional case
  else if (typeInfo.hasNull || typeInfo.hasUndefined) {
    const baseColumnDef = createColumnFromAST(typeInfo.coreType, Schema.make(typeInfo.coreType))
    const isComplexOptional = typeInfo.hasUndefined && !isPrimitiveAST(typeInfo.coreType)

    columnDef = {
      ...baseColumnDef,
      nullable: true,
      schema: isComplexOptional ? Schema.parseJson(schema) : schema,
    }
  }
  // Non-nullable type
  else {
    columnDef = createColumnFromAST(ast, schema)
  }

  // 4. Apply annotations
  const result = { ...columnDef }
  if (annotations.primaryKey) result.primaryKey = true
  if (annotations.autoIncrement) result.autoIncrement = true
  if (Option.isSome(annotations.defaultValue)) {
    result.default = Option.some(annotations.defaultValue.value)
  }

  return result
}

/**
 * Checks if a property signature has a specific annotation, checking both
 * the property signature itself and its type AST.
 */
const hasPropertyAnnotation = <T>(
  propertySignature: SchemaAST.PropertySignature,
  annotationId: symbol,
): Option.Option<T> => {
  // When using Schema.optional(Schema.String).pipe(withPrimaryKey) in a struct,
  // the annotation ends up on a PropertySignatureDeclaration, not the Union type
  // Check if this is a PropertySignatureDeclaration with annotations
  if ('annotations' in propertySignature && propertySignature.annotations) {
    const annotation = SchemaAST.getAnnotation<T>(annotationId)(propertySignature as any)
    if (Option.isSome(annotation)) {
      return annotation
    }
  }

  // Otherwise check the type AST
  return SchemaAST.getAnnotation<T>(annotationId)(propertySignature.type)
}

/**
 * Maps schema property signatures to SQLite column definitions.
 * Returns both columns and unique column names for index creation.
 */
export const schemaFieldsToColumns = (
  propertySignatures: ReadonlyArray<SchemaAST.PropertySignature>,
): { columns: SqliteDsl.Columns; uniqueColumns: string[] } => {
  const columns: SqliteDsl.Columns = {}
  const uniqueColumns: string[] = []

  for (const prop of propertySignatures) {
    if (typeof prop.name === 'string') {
      // Create a schema from the AST
      const fieldSchema = Schema.make(prop.type)
      // Check if property has primary key annotation
      const hasPrimaryKey = hasPropertyAnnotation<boolean>(prop, PrimaryKeyId).pipe(Option.getOrElse(() => false))
      // Check if property has unique annotation
      const hasUnique = hasPropertyAnnotation<boolean>(prop, Unique).pipe(Option.getOrElse(() => false))

      columns[prop.name] = schemaFieldToColumn(fieldSchema, prop, hasPrimaryKey)

      if (hasUnique) {
        uniqueColumns.push(prop.name)
      }
    }
  }

  return { columns, uniqueColumns }
}

/**
 * Converts a schema field and its property signature to a SQLite column definition.
 */
const schemaFieldToColumn = (
  fieldSchema: Schema.Schema.AnyNoContext,
  propertySignature: SchemaAST.PropertySignature,
  forceHasPrimaryKey?: boolean,
): SqliteDsl.ColumnDefinition.Any => {
  // Determine column type based on schema type
  const columnDef = getColumnDefForSchema(fieldSchema, propertySignature)

  // Create a new object with appropriate properties
  const result: Writeable<SqliteDsl.ColumnDefinition.Any> = {
    columnType: columnDef.columnType,
    schema: columnDef.schema,
    default: columnDef.default,
    nullable: columnDef.nullable,
    primaryKey: columnDef.primaryKey,
    autoIncrement: columnDef.autoIncrement,
  }

  // Set primaryKey property explicitly
  if (forceHasPrimaryKey || columnDef.primaryKey) {
    result.primaryKey = true
  } else {
    result.primaryKey = false
  }

  // Check for invalid primary key + nullable combination
  if (result.primaryKey && (propertySignature.isOptional || columnDef.nullable)) {
    return shouldNeverHappen(
      `Primary key columns cannot be nullable. Found nullable primary key for column. ` +
        `Either remove the primary key annotation or use a non-nullable schema.`,
    )
  }

  // Set nullable property explicitly
  if (propertySignature.isOptional) {
    result.nullable = true
  } else if (columnDef.nullable) {
    result.nullable = true
  } else {
    result.nullable = false
  }

  // Only add autoIncrement if it's true
  if (columnDef.autoIncrement) {
    result.autoIncrement = true
  }

  return result as SqliteDsl.ColumnDefinition.Any
}

/**
 * Resolves type information from an AST, unwrapping unions and tracking nullability.
 */
const resolveType = (
  ast: SchemaAST.AST,
): {
  coreType: SchemaAST.AST
  hasNull: boolean
  hasUndefined: boolean
} => {
  if (!SchemaAST.isUnion(ast)) {
    return { coreType: ast, hasNull: false, hasUndefined: false }
  }

  let hasNull = false
  let hasUndefined = false
  let coreType: SchemaAST.AST | undefined

  const visit = (type: SchemaAST.AST): void => {
    if (SchemaAST.isUndefinedKeyword(type)) {
      hasUndefined = true
    } else if (SchemaAST.isLiteral(type) && type.literal === null) {
      hasNull = true
    } else if (SchemaAST.isUnion(type)) {
      type.types.forEach(visit)
    } else if (!coreType) {
      coreType = type
    }
  }

  ast.types.forEach(visit)
  return { coreType: coreType || ast, hasNull, hasUndefined }
}

/**
 * Creates a column definition from an AST node.
 */
const createColumnFromAST = (
  ast: SchemaAST.AST,
  schema: Schema.Schema.AnyNoContext,
): SqliteDsl.ColumnDefinition.Any => {
  // Follow refinements and transformations to their core type
  if (SchemaAST.isRefinement(ast)) {
    // Special case for Schema.Int
    const identifier = SchemaAST.getIdentifierAnnotation(ast).pipe(Option.getOrElse(() => ''))
    if (identifier === 'Int') return SqliteDsl.integer()
    return createColumnFromAST(ast.from, Schema.make(ast.from))
  }

  if (SchemaAST.isTransformation(ast)) {
    return createColumnFromAST(ast.to, Schema.make(ast.to))
  }

  // Primitive types
  if (SchemaAST.isStringKeyword(ast)) return SqliteDsl.text()
  if (SchemaAST.isNumberKeyword(ast)) return SqliteDsl.real()
  if (SchemaAST.isBooleanKeyword(ast)) return SqliteDsl.boolean()

  // Literals
  if (SchemaAST.isLiteral(ast)) {
    const value = ast.literal
    if (typeof value === 'string') return SqliteDsl.text()
    if (typeof value === 'number') return SqliteDsl.real()
    if (typeof value === 'boolean') return SqliteDsl.boolean()
  }

  // Everything else is complex
  return SqliteDsl.json({ schema })
}

/**
 * Creates a column from a specific column type string.
 */
const createColumnFromType = (columnType: string, ast: SchemaAST.AST): SqliteDsl.ColumnDefinition.Any => {
  switch (columnType) {
    case 'text':
      return SqliteDsl.text()
    case 'integer':
      // Preserve boolean transformation
      return SchemaAST.isBooleanKeyword(ast) ? SqliteDsl.boolean() : SqliteDsl.integer()
    case 'real':
      return SqliteDsl.real()
    case 'blob':
      return SqliteDsl.blob()
    default:
      return shouldNeverHappen(`Unsupported column type: ${columnType}`)
  }
}

/**
 * Checks if an AST represents a primitive (non-complex) type.
 */
const isPrimitiveAST = (ast: SchemaAST.AST): boolean => {
  if (
    SchemaAST.isStringKeyword(ast) ||
    SchemaAST.isNumberKeyword(ast) ||
    SchemaAST.isBooleanKeyword(ast) ||
    SchemaAST.isLiteral(ast)
  ) {
    return true
  }

  if (SchemaAST.isRefinement(ast)) {
    return isPrimitiveAST(ast.from)
  }

  if (SchemaAST.isTransformation(ast)) {
    return isPrimitiveAST(ast.to)
  }

  return false
}
