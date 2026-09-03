import { SchemaAST } from '@livestore/utils/effect'

const getContentMediaType = SchemaAST.resolveAt<string>('contentMediaType')

export const hasJsonStringEncoding = (ast: SchemaAST.AST): boolean => hasJsonMediaType(SchemaAST.toEncoded(ast))

const hasJsonMediaType = (ast: SchemaAST.AST): boolean =>
  getContentMediaType(ast) === 'application/json' ||
  (SchemaAST.isUnion(ast) === true && ast.types.some(hasJsonMediaType))
