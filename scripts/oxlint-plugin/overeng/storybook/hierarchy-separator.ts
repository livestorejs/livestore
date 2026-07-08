/**
 * storybook/hierarchy-separator oxlint rule.
 *
 * The CSF Meta `title` should not use the deprecated `|` hierarchy separator;
 * use `/` instead. Offers an autofix that replaces `|` with `/`.
 *
 * @see Upstream SoT: eslint-plugin-storybook rule `hierarchy-separator` —
 *   https://github.com/storybookjs/storybook/blob/v10.4.6/code/lib/eslint-plugin/src/rules/hierarchy-separator.ts
 *
 * Reimplemented from eslint-plugin-storybook@10.4.6.
 *
 * Resync: when bumping the pinned Storybook version or CSF conventions, re-read
 * the upstream rule and reconcile behavior here. No intentional deviations.
 */

// NOTE: Using `any` types because oxlint JS plugin API doesn't have TypeScript definitions yet

import { getMetaObjectExpression } from './utils.ts'

/** oxlint rule: discourage the deprecated `|` hierarchy separator in the Meta title */
export const hierarchySeparatorRule = {
  meta: {
    type: 'problem' as const,
    fixable: 'code' as const,
    docs: {
      description: 'Deprecated hierarchy separator in title property',
      recommended: false,
    },
    messages: {
      deprecatedHierarchySeparator: 'Deprecated hierarchy separator in title property: {{metaTitle}}.',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context: any) {
    let program: any = null
    return {
      Program(node: any) {
        program = node
      },
      ExportDefaultDeclaration(node: any) {
        const meta = getMetaObjectExpression({ node, program })
        if (meta === null) return

        const titleNode = meta.properties.find(
          (prop: any) =>
            prop.type !== 'SpreadElement' && prop.key !== undefined && 'name' in prop.key && prop.key.name === 'title',
        )

        if (titleNode === undefined || titleNode.value?.type !== 'Literal') return

        const metaTitle = titleNode.value.raw ?? ''
        if (metaTitle.includes('|') === true) {
          context.report({
            node: titleNode,
            messageId: 'deprecatedHierarchySeparator',
            data: { metaTitle },
            fix: (fixer: any) => fixer.replaceTextRange(titleNode.value.range, metaTitle.replace(/\|/g, '/')),
          })
        }
      },
    }
  },
}
