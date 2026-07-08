/**
 * jsdoc-require-exports oxlint rule.
 *
 * Requires JSDoc comments on exported declarations.
 *
 * Requires JSDoc on:
 * - Type definitions: `export interface X`, `export type X = ...`
 * - Value exports: `export const X`, `export function X`, `export class X`
 * - Named namespace exports: `export * as name from '...'`
 *
 * Does NOT require JSDoc on:
 * - Re-exports: `export * from '...'`, `export { X } from '...'`, `export type { X } from '...'`
 * - Typeof-derived types: `export type X = typeof Y.Type`
 *
 * NOTE: JS plugins are experimental. WASM plugins may become available for better performance.
 * See: https://github.com/oxc-project/oxc/discussions/10342
 */

import type { TSESLint, TSESTree } from '@typescript-eslint/utils'

type ASTNode = TSESTree.Node
type RuleContext = Readonly<TSESLint.RuleContext<'missingJsdoc', []>>

/**
 * Check if a node has an adjacent JSDoc comment (block comment starting with *).
 * Only considers comments that end on the line immediately before the node starts,
 * or with only line comments in between (e.g. `// oxlint-disable-next-line`).
 * This avoids attributing module-level doc comments to the first export.
 */
const hasJsDocComment = ({ node, sourceCode }: { node: ASTNode; sourceCode: Readonly<TSESLint.SourceCode> }) => {
  const comments = sourceCode.getCommentsBefore(node)
  const nodeStartLine = node.loc?.start.line
  if (nodeStartLine === undefined) return false

  // Find all JSDoc comments and line comments, sorted by end line (descending)
  const sortedComments = [...comments]
    .filter((c) => c.loc?.end.line !== undefined)
    .toSorted((a, b) => b.loc!.end.line - a.loc!.end.line)

  // Track which lines are covered by line comments
  const lineCommentLines = new Set<number>()
  for (const comment of sortedComments) {
    if (comment.type === 'Line' && comment.loc?.start.line !== undefined) {
      lineCommentLines.add(comment.loc.start.line)
    }
  }

  for (const comment of sortedComments) {
    if (comment.type === 'Block' && comment.value.startsWith('*') === true) {
      const commentEndLine = comment.loc?.end.line
      if (commentEndLine === undefined) continue

      // Check if JSDoc is adjacent or only has line comments in between
      let isAdjacent = true
      for (let line = commentEndLine + 1; line < nodeStartLine; line++) {
        if (lineCommentLines.has(line) === false) {
          isAdjacent = false
          break
        }
      }

      if (isAdjacent === true) {
        return true
      }
    }
  }
  return false
}

/**
 * Check if a type alias is derived via typeof (e.g., `type User = typeof User.Type`).
 * These are excluded since the source should have documentation.
 */
const isDerivedTypeofAlias = (decl: any) => {
  if (decl?.type !== 'TSTypeAliasDeclaration') return false
  const typeAnnotation = decl.typeAnnotation
  // Check if the type annotation is a TSTypeQuery (typeof X)
  return typeAnnotation?.type === 'TSTypeQuery'
}

/**
 * Check if this is an export declaration that requires JSDoc.
 * Re-exports (export { X } from '...') are excluded - the source should have docs.
 * Typeof-derived type aliases are also excluded since they derive from documented sources.
 */
const isExportRequiringJsDoc = (node: ASTNode) => {
  if (node.type === 'ExportNamedDeclaration') {
    const n = node as any
    const decl = n.declaration

    /** No declaration means it's a re-export like `export { X } from '...'` */
    if (decl === undefined || decl === null) return false

    /** export type X = typeof Y - skip, derived types don't need JSDoc */
    if (decl.type === 'TSTypeAliasDeclaration' && isDerivedTypeofAlias(decl) === true) {
      return false
    }

    /** export interface ... */
    if (decl.type === 'TSInterfaceDeclaration') return true

    /** export type X = ... (non-typeof-derived) */
    if (decl.type === 'TSTypeAliasDeclaration') return true

    /** export const X = ... / export let X = ... */
    if (decl.type === 'VariableDeclaration') return true

    /** export function X() { ... } */
    if (decl.type === 'FunctionDeclaration') return true

    /** export class X { ... } */
    if (decl.type === 'ClassDeclaration') return true
  }
  return false
}

/** Get a description for the export for the error message. */
const getExportDescription = (node: ASTNode) => {
  if (node.type === 'ExportAllDeclaration') {
    return `* from '${(node as any).source.value}'`
  }

  if (node.type === 'ExportNamedDeclaration') {
    const n = node as any
    const decl = n.declaration

    if (decl?.type === 'TSInterfaceDeclaration') {
      return `interface ${decl.id.name}`
    }
    if (decl?.type === 'TSTypeAliasDeclaration') {
      return `type ${decl.id.name}`
    }
    if (decl?.type === 'VariableDeclaration') {
      const names = decl.declarations.map((d: any) => d.id?.name ?? 'unknown').join(', ')
      return `const ${names}`
    }
    if (decl?.type === 'FunctionDeclaration') {
      return `function ${decl.id?.name ?? 'unknown'}`
    }
    if (decl?.type === 'ClassDeclaration') {
      return `class ${decl.id?.name ?? 'unknown'}`
    }
  }

  return 'export'
}

/** ESLint rule requiring JSDoc comments on exported declarations */
export const jsdocRequireExportsRule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Require JSDoc comments on exported declarations',
      recommended: false,
    },
    messages: {
      missingJsdoc: "Missing JSDoc comment for exported '{{name}}'.",
    },
    schema: [],
  } as const,
  defaultOptions: [],
  create(context: RuleContext) {
    const { sourceCode } = context
    // Track function names that have overload signatures (TSDeclareFunction)
    // Used to skip JSDoc check on implementation signatures (FunctionDeclaration)
    const functionOverloads = new Set<string>()

    return {
      ExportAllDeclaration(node: ASTNode) {
        // Only require JSDoc for named namespace exports: export * as name from '...'
        // Plain re-exports (export * from '...') don't need JSDoc
        const n = node as any
        if (n.exported === undefined || n.exported === null) return

        if (hasJsDocComment({ node, sourceCode }) === false) {
          context.report({
            node,
            messageId: 'missingJsdoc',
            data: { name: getExportDescription(node) },
          })
        }
      },

      ExportNamedDeclaration(node: ASTNode) {
        const n = node as any
        const decl = n.declaration

        // Handle function overloads: TSDeclareFunction is an overload signature,
        // FunctionDeclaration is the implementation
        if (decl?.type === 'TSDeclareFunction') {
          const funcName = decl.id?.name
          if (funcName !== undefined) {
            // Only check JSDoc on the FIRST overload signature
            if (functionOverloads.has(funcName) === false) {
              functionOverloads.add(funcName)
              if (hasJsDocComment({ node, sourceCode }) === false) {
                context.report({
                  node,
                  messageId: 'missingJsdoc',
                  data: { name: `function ${funcName}` },
                })
              }
            }
          }
          return
        }

        if (isExportRequiringJsDoc(node) === false) return

        // For function implementations, skip if there's a prior overload signature
        if (decl?.type === 'FunctionDeclaration') {
          const funcName = decl.id?.name
          if (funcName !== undefined && functionOverloads.has(funcName) === true) {
            // This is the implementation of an overloaded function - skip JSDoc check
            // The first overload signature should have the JSDoc
            return
          }
        }

        if (hasJsDocComment({ node, sourceCode }) === false) {
          context.report({
            node,
            messageId: 'missingJsdoc',
            data: { name: getExportDescription(node) },
          })
        }
      },
    }
  },
}
