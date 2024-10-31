import { Schema, SchemaAST } from 'effect'

export type DiffItem = {
  path: string
  a: any
  b: any
  ast: SchemaAST.AST
}

/**
 * Diffs two values for a given schema and traverses downwards and returns a list of differences.
 */
export const debugDiff =
  <A, I, R>(base: Schema.Schema<A, I, R>) =>
  (a: A, b: A): DiffItem[] => {
    const bag = [] as DiffItem[]
    debugDiffImpl(base.ast, a, b, '', bag)
    return bag
  }

const debugDiffImpl = (ast: SchemaAST.AST, a: any, b: any, path: string, bag: DiffItem[]) => {
  const eq = Schema.equivalence({ ast } as any)
  if (eq(a, b) === false) {
    // bag.push({ path, a, b, ast })

    if (SchemaAST.isUnion(ast)) {
      if (isTaggedUnion(ast)) {
        bag.push({ path, a, b, ast })
        return
      } else {
        for (const type of ast.types) {
          try {
            debugDiffImpl(type, a, b, path, bag)
            return
          } catch {}
        }
      }
    } else if (SchemaAST.isTypeLiteral(ast)) {
      const props = SchemaAST.getPropertySignatures(ast)
      for (const prop of props) {
        debugDiffImpl(prop.type, a[prop.name], b[prop.name], `${path}.${prop.name.toString()}`, bag)
      }
    } else {
      // debugger
      bag.push({ path, a, b, ast })
    }
  }
}

const isTaggedUnion = (ast: SchemaAST.AST) => {
  if (SchemaAST.isUnion(ast)) {
    return ast.types.every((type) => {
      if (SchemaAST.isTypeLiteral(type) === false) return false
      const props = SchemaAST.getPropertySignatures(type)
      return props.some((prop) => prop.name.toString() === '_tag')
    })
  }
}
