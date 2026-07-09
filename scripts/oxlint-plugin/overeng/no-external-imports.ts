/**
 * no-external-imports oxlint rule.
 *
 * Disallow value imports and re-exports from npm packages (non-relative, non-builtin specifiers).
 * Type-only imports and exports are allowed since they're erased at compile time.
 *
 * Only relative paths (`./`, `../`) and Node.js builtins (`node:*`) are permitted.
 * Bare specifiers like `fs` (without `node:` prefix) are treated as external.
 *
 * Use this rule via overrides to enforce dependency-free modules that are imported
 * as TypeScript source by consumers.
 *
 * @example
 * // ✅ Good - relative imports
 * import { foo } from './foo.ts'
 * import { bar } from '../bar/mod.ts'
 *
 * // ✅ Good - Node.js builtins
 * import { readFile } from 'node:fs'
 * import path from 'node:path'
 *
 * // ✅ Good - type-only imports (erased at compile time)
 * import type { Effect } from 'effect'
 * import type { FileSystem } from '@effect/platform'
 * import { type Effect, type pipe } from 'effect'
 *
 * // ✅ Good - type-only re-exports
 * export type { PackageInfo } from 'effect'
 *
 * // ❌ Bad - value imports from npm packages
 * import { Effect } from 'effect'
 * import { FileSystem } from '@effect/platform'
 *
 * // ❌ Bad - value re-exports from npm packages
 * export { something } from 'effect'
 * export * from '@effect/platform'
 *
 * // ❌ Bad - mixed (has at least one value specifier)
 * import { type Effect, pipe } from 'effect'
 *
 */

const isExternalSpecifier = (source: string): boolean => !source.startsWith('.') && !source.startsWith('node:')

/**
 * Check if an import declaration is fully type-only.
 *
 * An import is type-only if:
 * - The declaration itself is `import type { ... }` (importKind === 'type')
 * - OR all individual specifiers use inline `type` keyword: `import { type A, type B }`
 * - OR it's a side-effect import with no specifiers (e.g. `import 'x'`) — but those
 *   are still value imports and should be flagged
 */
const isTypeOnlyImport = (node: any): boolean => {
  // import type { X } from 'y' or import type X from 'y'
  if (node.importKind === 'type') return true

  // No specifiers means side-effect import (import 'x') — not type-only
  const specifiers = node.specifiers
  if (Array.isArray(specifiers) === false || specifiers.length === 0) return false

  // import { type A, type B } from 'y' — all specifiers must be type-kind
  return specifiers.every((s: any) => s.importKind === 'type')
}

/**
 * Check if an export declaration is fully type-only.
 *
 * An export is type-only if:
 * - The declaration itself is `export type { ... }` (exportKind === 'type')
 * - OR all individual specifiers use inline `type` keyword: `export { type A, type B }`
 */
const isTypeOnlyExport = (node: any): boolean => {
  if (node.exportKind === 'type') return true

  const specifiers = node.specifiers
  if (Array.isArray(specifiers) === false || specifiers.length === 0) return false

  return specifiers.every((s: any) => s.exportKind === 'type')
}

/** ESLint rule disallowing value imports/exports from npm packages */
export const noExternalImportsRule = {
  meta: {
    type: 'problem' as const,
    docs: {
      description: 'Disallow value imports and re-exports from npm packages (type-only imports are allowed)',
      recommended: false,
    },
    messages: {
      noExternalImport:
        'Value import from "{{source}}" is not allowed. This module must be dependency-free. Use `import type` for type-only imports, or move the code to a module that allows dependencies.',
      noExternalExport:
        'Value re-export from "{{source}}" is not allowed. This module must be dependency-free. Use `export type` for type-only re-exports, or move the code to a module that allows dependencies.',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context: any) {
    return {
      ImportDeclaration(node: any) {
        if (isTypeOnlyImport(node) === true) return

        const source = node.source?.value
        if (typeof source !== 'string') return

        if (isExternalSpecifier(source) === true) {
          context.report({
            node,
            messageId: 'noExternalImport',
            data: { source },
          })
        }
      },

      // export { x } from 'pkg' or export { type X, y } from 'pkg'
      ExportNamedDeclaration(node: any) {
        // Only check re-exports (those with a source)
        if (node.source === undefined) return
        if (isTypeOnlyExport(node) === true) return

        const source = node.source?.value
        if (typeof source !== 'string') return

        if (isExternalSpecifier(source) === true) {
          context.report({
            node,
            messageId: 'noExternalExport',
            data: { source },
          })
        }
      },

      // export * from 'pkg'
      ExportAllDeclaration(node: any) {
        // export type * from 'pkg' is type-only
        if (node.exportKind === 'type') return

        const source = node.source?.value
        if (typeof source !== 'string') return

        if (isExternalSpecifier(source) === true) {
          context.report({
            node,
            messageId: 'noExternalExport',
            data: { source },
          })
        }
      },
    }
  },
}
