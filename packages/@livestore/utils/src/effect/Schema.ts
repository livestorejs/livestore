import type { JSONSchema } from '@effect/schema'
import { AST, Schema } from '@effect/schema'
import { Predicate } from 'effect'

export * from '@effect/schema/Schema'

/**
 * Check if `schema2` is a subtype of `schema1`.
 * e.g. whether data encoded with `schema1` can be decoded with `schema2`.
 *
 * Hopefully this will be implemented in `@effect/schema` itself in the future (see https://github.com/Effect-TS/effect/issues/2661).
 *
 * Related:
 * - https://github.com/IBM/jsonsubschema
 */
export const isSubType = <A1, A2, I1, I2>(schema1: Schema.Schema<A1, I1>, schema2: Schema.Schema<A2, I2>): boolean => {
  if (Schema.hash(schema1) === Schema.hash(schema2)) {
    return true
  }

  return isSubTypeAst(AST.typeAST(schema1.ast), AST.typeAST(schema2.ast))
}

const isSubTypeAst = (ast1: AST.AST, ast2: AST.AST): boolean => {
  if (ast1._tag !== ast2._tag && AST.isUnion(ast2)) {
    const matchingAst2Arr = ast2.types.filter((t) => t._tag === ast1._tag)
    if (matchingAst2Arr.length === 0) {
      return false
    }

    return matchingAst2Arr.some((matchingAst2) => isSubTypeAst(ast1, matchingAst2))
  }

  if (ast1._tag === 'TypeLiteral' && ast2._tag === 'TypeLiteral') {
    // make sure all properties in schema1 are also in schema2
    for (const prop1 of ast1.propertySignatures) {
      const prop2 = ast2.propertySignatures.find((p) => p.name === prop1.name)
      if (prop2 === undefined) {
        return false
      }

      // Make sure optional properties in schema1 are also optional in schema2 or have a default value
      if (prop1.isOptional && !prop2.isOptional && AST.getDefaultAnnotation(prop2)._tag === 'None') {
        return false
      }

      if (!isSubTypeAst(prop1.type, prop2.type)) {
        return false
      }
    }

    const propertySignaturesByName1 = new Map(ast1.propertySignatures.map((p) => [p.name, p]))

    // Make sure there are no new required properties in schema2 that are not in schema1
    for (const prop2 of ast2.propertySignatures) {
      if (!prop2.isOptional && propertySignaturesByName1.has(prop2.name) === false) {
        return false
      }
    }
  }

  return true
}

export const decodeJSONSchema = <A>(schema: JSONSchema.JsonSchema7Root): Schema.Schema<A> =>
  Schema.make(decodeAST(schema, schema.$defs))

const DEFINITION_PREFIX = '#/$defs/'

const emptyTypeLiteralAST = new AST.TypeLiteral([], [])

const decodeAST = (schema: JSONSchema.JsonSchema7, $defs: JSONSchema.JsonSchema7Root['$defs']): AST.AST => {
  if ('$id' in schema) {
    switch (schema.$id) {
      case '/schemas/any': {
        return AST.anyKeyword
      }
      case '/schemas/unknown': {
        return AST.unknownKeyword
      }
      case '/schemas/object': {
        return AST.objectKeyword
      }
      case '/schemas/{}': {
        return emptyTypeLiteralAST
      }
    }
  } else if ('const' in schema) {
    return new AST.Literal(schema.const)
  } else if ('type' in schema) {
    const type = schema.type
    switch (type) {
      case 'string': {
        return AST.stringKeyword
      }
      case 'number': {
        return AST.numberKeyword
      }
      case 'integer': {
        return AST.numberKeyword
      }
      case 'boolean': {
        return AST.booleanKeyword
      }
      case 'array': {
        if (schema.items) {
          if (Array.isArray(schema.items)) {
            const minItems = schema.minItems ?? -1
            const rest: AST.TupleType['rest'] =
              schema.additionalItems && !Predicate.isBoolean(schema.additionalItems)
                ? [decodeAST(schema.additionalItems, $defs)]
                : []
            return new AST.TupleType(
              schema.items.map((item, i) => new AST.Element(decodeAST(item, $defs), i >= minItems)),
              rest,
              true,
            )
          } else {
            return new AST.TupleType([], [decodeAST(schema.items, $defs)], true)
          }
        } else {
          return new AST.TupleType([], [], true)
        }
      }
      case 'object': {
        const required = schema.required || []
        const propertySignatures: AST.PropertySignature[] = []
        const indexSignatures: AST.IndexSignature[] = []
        for (const name in schema.properties) {
          propertySignatures.push(
            new AST.PropertySignature(name, decodeAST(schema.properties[name]!, $defs), !required.includes(name), true),
          )
        }
        if (schema.additionalProperties && !Predicate.isBoolean(schema.additionalProperties)) {
          indexSignatures.push(
            new AST.IndexSignature(AST.stringKeyword, decodeAST(schema.additionalProperties, $defs), true),
          )
        }
        if (schema.patternProperties) {
          for (const pattern in schema.patternProperties) {
            indexSignatures.push(
              new AST.IndexSignature(
                Schema.String.pipe(Schema.pattern(new RegExp(pattern))).ast,
                decodeAST(schema.patternProperties[pattern]!, $defs),
                true,
              ),
            )
          }
        }
        return new AST.TypeLiteral(propertySignatures, indexSignatures)
      }
      // No default
    }
  } else if ('enum' in schema) {
    return AST.Union.make(schema.enum.map((literal) => new AST.Literal(literal)))
  } else if ('anyOf' in schema) {
    return AST.Union.make(schema.anyOf.map((s) => decodeAST(s, $defs)))
  } else if ('oneOf' in schema) {
    if ('$comment' in schema && schema.$comment === '/schemas/enums') {
      return new AST.Enums(schema.oneOf.map((e) => [e.title, e.const]))
    }
    return AST.Union.make(schema.oneOf.map((s) => decodeAST(s, $defs)))
  } else if ('$ref' in schema) {
    if ($defs) {
      // const id = schema.$ref.substring(JSONSchema.DEFINITION_PREFIX.length)
      const id = schema.$ref.slice(DEFINITION_PREFIX.length)
      if (id in $defs) {
        return decodeAST($defs[id]!, $defs)
      }
    }
    throw new Error(`cannot find $ref: ${schema.$ref}`)
  }
  throw new Error(`cannot decode: ${JSON.stringify(schema, null, 2)}`)
}
