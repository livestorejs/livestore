/**
 * storybook/story-exports oxlint rule.
 *
 * A `*.stories.*` file that has a CSF Meta default export should also have at
 * least one valid named story export. Files using the legacy `storiesOf` API or
 * without a Meta object are exempt.
 *
 * @see Upstream SoT: eslint-plugin-storybook rule `story-exports` —
 *   https://github.com/storybookjs/storybook/blob/v10.4.6/code/lib/eslint-plugin/src/rules/story-exports.ts
 *
 * Reimplemented from eslint-plugin-storybook@10.4.6.
 *
 * Resync: when bumping the pinned Storybook version or CSF conventions, re-read
 * the upstream rule and reconcile behavior here. No intentional deviations
 * beyond the shared `getMetaObjectExpression` const-resolution note in utils.ts.
 */

// NOTE: Using `any` types because oxlint JS plugin API doesn't have TypeScript definitions yet

import {
  getAllNamedExports,
  getDescriptor,
  getMetaObjectExpression,
  isStoriesOfImportSpecifier,
  isValidStoryExport,
  type IncludeExcludeOptions,
} from './utils.ts'

/** oxlint rule: a story file with a Meta should have at least one story export */
export const storyExportsRule = {
  meta: {
    type: 'problem' as const,
    docs: {
      description: 'A story file must contain at least one story export',
      recommended: false,
    },
    messages: {
      shouldHaveStoryExport: 'The file should have at least one story export',
      shouldHaveStoryExportWithFilters:
        'The file should have at least one story export. Make sure the includeStories/excludeStories you defined are correct, otherwise Storybook will not use any stories for this file.',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context: any) {
    let program: any = null
    let hasStoriesOfImport = false
    let nonStoryExportsConfig: IncludeExcludeOptions = {}
    let meta: any = null
    const namedExports: any[] = []

    return {
      Program(node: any) {
        program = node
      },
      ImportSpecifier(node: any) {
        if (isStoriesOfImportSpecifier(node) === true) hasStoriesOfImport = true
      },
      ExportDefaultDeclaration(node: any) {
        meta = getMetaObjectExpression({ node, program })
        if (meta !== null) {
          nonStoryExportsConfig = {
            excludeStories: getDescriptor({ meta, propertyName: 'excludeStories' }),
            includeStories: getDescriptor({ meta, propertyName: 'includeStories' }),
          }
        }
      },
      ExportNamedDeclaration(node: any) {
        namedExports.push(...getAllNamedExports(node))
      },
      'Program:exit'(programNode: any) {
        if (hasStoriesOfImport === true || meta === null) return

        const storyExports = namedExports.filter(
          (exp) => isValidStoryExport({ name: exp.name, config: nonStoryExportsConfig }) === true,
        )
        if (storyExports.length > 0) return

        const firstNonImport = programNode.body.find((n: any) => n.type !== 'ImportDeclaration')
        const node = firstNonImport ?? programNode.body[0] ?? programNode

        const hasFilter =
          nonStoryExportsConfig.includeStories !== undefined || nonStoryExportsConfig.excludeStories !== undefined
        context.report({
          node,
          messageId: hasFilter === true ? 'shouldHaveStoryExportWithFilters' : 'shouldHaveStoryExport',
        })
      },
    }
  },
}
