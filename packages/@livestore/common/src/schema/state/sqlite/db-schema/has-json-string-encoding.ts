import { type SchemaAST, SchemaRepresentation } from '@livestore/utils/effect'

/**
 * Since Effect 4.1 the JSON media type of `Schema.fromJsonString` lives on its (internal) encoding transformation
 * instead of a `contentMediaType` annotation. `SchemaRepresentation` is the public API that surfaces it, as
 * `content.mediaType` on the encoded string. References are inlined so unions can be inspected directly.
 */
export const hasJsonStringEncoding = (ast: SchemaAST.AST): boolean =>
  hasJsonMediaType(SchemaRepresentation.toRepresentation(ast, { referencePolicy: () => undefined }).representation)

const hasJsonMediaType = (representation: SchemaRepresentation.Representation): boolean =>
  (representation._tag === 'String' && representation.content?.mediaType === 'application/json') ||
  (representation._tag === 'Union' && representation.types.some(hasJsonMediaType))
