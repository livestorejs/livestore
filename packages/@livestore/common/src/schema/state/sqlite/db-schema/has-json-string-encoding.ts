import { type SchemaAST, SchemaRepresentation } from '@livestore/utils/effect'

/**
 * Detects whether a schema encodes to a JSON string (e.g. `Schema.fromJsonString(...)`), directly or as a union member.
 *
 * Since Effect 4.1 the JSON media type is no longer a `contentMediaType` annotation on the encoded string.
 * It is carried by the encoding transformation and surfaced publicly as `content.mediaType` on the
 * schema representation, so we read it from there.
 */
export const hasJsonStringEncoding = (ast: SchemaAST.AST): boolean => {
  const { representation, references } = SchemaRepresentation.toRepresentation(ast)
  return hasJsonMediaType(representation, references, new Set())
}

const hasJsonMediaType = (
  representation: SchemaRepresentation.Representation,
  references: SchemaRepresentation.References,
  visited: Set<string>,
): boolean => {
  switch (representation._tag) {
    case 'String':
      return representation.content?.mediaType === 'application/json'
    case 'Union':
      return representation.types.some((member) => hasJsonMediaType(member, references, visited))
    case 'Reference': {
      // Guard against recursive schemas, which reference themselves.
      if (visited.has(representation.$ref) === true) return false
      visited.add(representation.$ref)
      const target = references[representation.$ref]
      return target !== undefined && hasJsonMediaType(target, references, visited)
    }
    default:
      return false
  }
}
