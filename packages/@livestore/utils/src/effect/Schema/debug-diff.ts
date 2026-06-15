import { Schema, SchemaAST } from 'effect'

export type DiffItem = {
  path: string
  a: unknown
  b: unknown
  ast: SchemaAST.AST
}

/**
 * Diffs two values for a given schema and traverses downwards and returns a list of differences.
 */
export const debugDiff =
  <A>(base: Schema.Schema<A>) =>
  (a: A, b: A): DiffItem[] => {
    const bag = [] as DiffItem[]
    debugDiffImpl(base.ast, a, b, '', bag)
    return bag
  }

const debugDiffImpl = (ast: SchemaAST.AST, a: unknown, b: unknown, path: string, bag: DiffItem[]) => {
  const eq = Schema.toEquivalence(Schema.make<Schema.Schema<unknown>>(ast))
  if (eq(a, b) === false) {
    // bag.push({ path, a, b, ast })

    if (SchemaAST.isUnion(ast) === true) {
      if (isTaggedUnion(ast) === true) {
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
    } else if (SchemaAST.isObjects(ast) === true) {
      const props = ast.propertySignatures
      for (const prop of props) {
        debugDiffImpl(
          prop.type,
          getProperty(a, prop.name),
          getProperty(b, prop.name),
          `${path}.${prop.name.toString()}`,
          bag,
        )
      }
    } else {
      // debugger
      bag.push({ path, a, b, ast })
    }
  }
}

const isTaggedUnion = (ast: SchemaAST.AST): boolean => {
  if (SchemaAST.isUnion(ast) === true) {
    return ast.types.every((type) => {
      if (SchemaAST.isObjects(type) === false) return false
      const props = type.propertySignatures
      return props.some((prop) => prop.name.toString() === '_tag')
    })
  }
  return false
}

const getProperty = (value: unknown, key: PropertyKey): unknown =>
  typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined
