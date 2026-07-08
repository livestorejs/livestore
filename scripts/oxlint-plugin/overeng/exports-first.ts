/**
 * exports-first oxlint rule.
 *
 * Enforce exported declarations appear before non-exported declarations.
 * This helps with code readability by putting the public API at the top of files.
 *
 * The rule is "control-flow aware": private declarations that are referenced by
 * subsequent exports are allowed to appear before those exports.
 *
 * NOTE: This rule sometimes conflicts with func-style (arrow functions). When both are
 * enabled, func-style requires arrow functions, but exports-first requires function
 * declarations for hoisting (to export before non-exported code). In these rare edge
 * cases, use a disable comment for func-style:
 *   // oxlint-disable-next-line func-style -- exports-first requires function declaration
 *   export function MyComponent() { ... }
 *
 * @example
 * // ✅ Good - exports first
 * export const publicApi = () => {}
 * export const anotherExport = 42
 * const helper = () => {}
 *
 * // ✅ Good - private dependency before export that uses it
 * const MAX_OPTIONS = 5
 * export const LiteralField = () => { return MAX_OPTIONS }
 *
 * // ❌ Bad - non-export before export (not referenced)
 * const unrelatedHelper = () => {}
 * export const publicApi = () => {}
 *
 * // ❌ Bad - late export (export { x } after non-exported code)
 * const publicApi = () => {}
 * const helper = () => {}
 * export { publicApi }
 */

// NOTE: Using `any` types because oxlint JS plugin API doesn't have TypeScript definitions yet

/** Check if a node is a declaration that should be tracked. */
const isTrackableDeclaration = (node: any): boolean => {
  const type = node.type
  return (
    type === 'VariableDeclaration' ||
    type === 'FunctionDeclaration' ||
    type === 'ClassDeclaration' ||
    type === 'TSEnumDeclaration'
  )
}

/** Check if a node is an export declaration (named or default). */
const isExportDeclaration = (node: any): boolean =>
  node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration'

/** Check if an export is a re-export (no declaration, just re-exporting from another module). */
const isReExport = (node: any): boolean => node.type === 'ExportNamedDeclaration' && node.source !== null

/** Check if this is a type-only export (should be ignored). */
const isTypeOnlyExport = (node: any): boolean => {
  if (node.type === 'ExportNamedDeclaration') {
    return node.exportKind === 'type'
  }
  return false
}

/** Get declared names from a declaration node. */
const getDeclaredNames = (node: any): Set<string> => {
  const names = new Set<string>()

  if (node.type === 'VariableDeclaration') {
    for (const decl of node.declarations) {
      if (decl.id.type === 'Identifier') {
        names.add(decl.id.name)
      } else if (decl.id.type === 'ObjectPattern') {
        for (const prop of decl.id.properties) {
          if (prop.type === 'Property' && prop.value.type === 'Identifier') {
            names.add(prop.value.name)
          } else if (prop.type === 'RestElement' && prop.argument.type === 'Identifier') {
            names.add(prop.argument.name)
          }
        }
      } else if (decl.id.type === 'ArrayPattern') {
        for (const elem of decl.id.elements) {
          if (elem?.type === 'Identifier') {
            names.add(elem.name)
          }
        }
      }
    }
  } else if (
    node.type === 'FunctionDeclaration' ||
    node.type === 'ClassDeclaration' ||
    node.type === 'TSEnumDeclaration'
  ) {
    if (node.id?.name !== undefined) {
      names.add(node.id.name)
    }
  }

  return names
}

/** Collect all identifier references in a node (recursively). */
const collectReferences = (opts: { node: any; refs?: Set<string> }): Set<string> => {
  const { node } = opts
  const refs = opts.refs ?? new Set()
  if (node === undefined || node === null || typeof node !== 'object') return refs

  if (node.type === 'Identifier') {
    refs.add(node.name)
    return refs
  }

  for (const key of Object.keys(node)) {
    if (key === 'parent' || key === 'loc' || key === 'range') continue

    const value = node[key]
    if (Array.isArray(value) === true) {
      for (const item of value) {
        collectReferences({ node: item, refs })
      }
    } else if (value !== undefined && value !== null && typeof value === 'object') {
      collectReferences({ node: value, refs })
    }
  }

  return refs
}

/** Get the declaration part of an export node. */
const getExportDeclaration = (node: any): any => {
  if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration') {
    return node.declaration
  }
  return null
}

/** ESLint rule enforcing exported declarations come before non-exported ones */
export const exportsFirstRule = {
  meta: {
    type: 'suggestion' as const,
    docs: {
      description: 'Enforce exported declarations come before non-exported declarations',
      recommended: false,
    },
    messages: {
      exportAfterNonExport:
        'Exported declaration should come before non-exported declarations. Move this export above non-exported code.',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context: any) {
    return {
      Program(programNode: any) {
        /**
         * Fast-path:
         * - If there are no exports, nothing to report.
         * - If there are no trackable non-exports, nothing to report.
         * - If every export appears before the first trackable non-export, nothing to report.
         *
         * This avoids the heavier reference collection for the common "already ordered" case.
         */
        let hasExport = false
        let hasTrackableNonExport = false
        let exportAfterNonExport = false

        for (const node of programNode.body) {
          // Skip import statements
          if (node.type === 'ImportDeclaration') {
            continue
          }

          // Skip re-exports
          if (isReExport(node) === true) {
            continue
          }

          // Skip type-only exports
          if (isTypeOnlyExport(node) === true) {
            continue
          }

          if (isExportDeclaration(node) === true) {
            hasExport = true
            if (hasTrackableNonExport === true) {
              exportAfterNonExport = true
              break
            }
            continue
          }

          if (isTrackableDeclaration(node) === true) {
            hasTrackableNonExport = true
          }
        }

        if (hasExport === false || hasTrackableNonExport === false || exportAfterNonExport === false) {
          return
        }

        // First pass: collect all non-exported declarations and their positions
        const nonExportedDecls: Array<{
          names: Set<string>
          node: any
          index: number
        }> = []
        const exports: Array<{ node: any; index: number; refs: Set<string> }> = []

        for (let i = 0; i < programNode.body.length; i++) {
          const node = programNode.body[i]

          if (node.type === 'ImportDeclaration') continue
          if (isReExport(node) === true) continue
          if (isTypeOnlyExport(node) === true) continue

          if (isExportDeclaration(node) === true) {
            const decl = getExportDeclaration(node)
            const refs = decl !== undefined ? collectReferences({ node: decl }) : new Set<string>()
            exports.push({ node, index: i, refs })
          } else if (isTrackableDeclaration(node) === true) {
            const names = getDeclaredNames(node)
            nonExportedDecls.push({ names, node, index: i })
          }
        }

        const referencedByAnyExport = new Set<string>()
        for (const exp of exports) {
          for (const ref of exp.refs) {
            referencedByAnyExport.add(ref)
          }
        }

        let changed = true
        while (changed === true) {
          changed = false
          for (const decl of nonExportedDecls) {
            let isNeeded = false
            for (const name of decl.names) {
              if (referencedByAnyExport.has(name) === true) {
                isNeeded = true
                break
              }
            }

            if (isNeeded === true) {
              const declRefs = collectReferences({ node: decl.node })
              for (const ref of declRefs) {
                if (referencedByAnyExport.has(ref) === false) {
                  referencedByAnyExport.add(ref)
                  changed = true
                }
              }
            }
          }
        }

        for (const exp of exports) {
          for (const decl of nonExportedDecls) {
            if (decl.index < exp.index) {
              let isReferenced = false
              for (const name of decl.names) {
                if (referencedByAnyExport.has(name) === true) {
                  isReferenced = true
                  break
                }
              }

              if (isReferenced === false) {
                context.report({
                  node: exp.node,
                  messageId: 'exportAfterNonExport',
                })
                break
              }
            }
          }
        }
      },
    }
  },
}
