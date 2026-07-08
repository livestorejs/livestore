/**
 * storybook/default-exports oxlint rule.
 *
 * A `*.stories.*` file must have a default export (the CSF Meta object).
 * Files using the legacy `storiesOf` API or CSF4 `config.meta()` style are
 * exempt.
 *
 * @see Upstream SoT: eslint-plugin-storybook rule `default-exports` —
 *   https://github.com/storybookjs/storybook/blob/v10.4.6/code/lib/eslint-plugin/src/rules/default-exports.ts
 *
 * Reimplemented from eslint-plugin-storybook@10.4.6.
 *
 * Resync: when bumping the pinned Storybook version or CSF conventions, re-read
 * the upstream rule and reconcile behavior here. Intentional deviation: the
 * upstream autofix that derives the component name from a matching import and
 * inserts `export default { component: X }` is not ported, because deriving the
 * component name relies on `context.filename` path resolution that is brittle
 * across the oxlint runtime; this rule reports only (detection, no fix).
 */

// NOTE: Using `any` types because oxlint JS plugin API doesn't have TypeScript definitions yet

import { isStoriesOfImportSpecifier } from './utils.ts'

/** Whether a top-level VariableDeclaration is a CSF4 `const meta = config.meta({})`. */
const isCsf4MetaDeclaration = (node: any): boolean => {
  if (node.parent?.type !== 'Program') return false
  for (const declaration of node.declarations) {
    const init = declaration.init
    if (init?.type === 'CallExpression') {
      const callee = init.callee
      if (
        callee?.type === 'MemberExpression' &&
        callee.property?.type === 'Identifier' &&
        callee.property.name === 'meta'
      ) {
        return true
      }
    }
  }
  return false
}

/** oxlint rule: a story file must have a default export (the Meta) */
export const defaultExportsRule = {
  meta: {
    type: 'problem' as const,
    docs: {
      description: 'Story files should have a default export',
      recommended: false,
    },
    messages: {
      shouldHaveDefaultExport: 'The file should have a default export.',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context: any) {
    let hasDefaultExport = false
    let isCsf4Style = false
    let hasStoriesOfImport = false

    return {
      ImportSpecifier(node: any) {
        if (isStoriesOfImportSpecifier(node) === true) hasStoriesOfImport = true
      },
      VariableDeclaration(node: any) {
        if (isCsf4MetaDeclaration(node) === true) isCsf4Style = true
      },
      ExportDefaultDeclaration() {
        hasDefaultExport = true
      },
      'Program:exit'(program: any) {
        if (isCsf4Style === true || hasDefaultExport === true || hasStoriesOfImport === true) {
          return
        }

        const firstNonImport = program.body.find((n: any) => n.type !== 'ImportDeclaration')
        const node = firstNonImport ?? program.body[0] ?? program
        context.report({ node, messageId: 'shouldHaveDefaultExport' })
      },
    }
  },
}
