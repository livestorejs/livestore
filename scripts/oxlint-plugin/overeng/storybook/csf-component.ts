/**
 * storybook/csf-component oxlint rule.
 *
 * The CSF Meta object (the default export of a `*.stories.*` file) should
 * declare a `component` property.
 *
 * @see Upstream SoT: eslint-plugin-storybook rule `csf-component` —
 *   https://github.com/storybookjs/storybook/blob/v10.4.6/code/lib/eslint-plugin/src/rules/csf-component.ts
 *
 * Reimplemented from eslint-plugin-storybook@10.4.6.
 *
 * Resync: when bumping the pinned Storybook version or CSF conventions, re-read
 * the upstream rule and reconcile behavior here. No intentional deviations.
 */

// NOTE: Using `any` types because oxlint JS plugin API doesn't have TypeScript definitions yet

import { getMetaObjectExpression } from './utils.ts'

/** oxlint rule: the Meta object should declare a `component` property */
export const csfComponentRule = {
  meta: {
    type: 'suggestion' as const,
    docs: {
      description: 'The component property should be set in the CSF Meta object',
      recommended: false,
    },
    messages: {
      missingComponentProperty: 'Missing component property.',
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

        const componentProperty = meta.properties.find(
          (property: any) =>
            property.type !== 'SpreadElement' &&
            property.key !== undefined &&
            'name' in property.key &&
            property.key.name === 'component',
        )

        if (componentProperty === undefined) {
          context.report({ node, messageId: 'missingComponentProperty' })
        }
      },
    }
  },
}
