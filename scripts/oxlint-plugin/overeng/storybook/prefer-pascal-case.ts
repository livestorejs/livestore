/**
 * storybook/prefer-pascal-case oxlint rule.
 *
 * Named story exports should use PascalCase. Non-story exports (per the Meta
 * include/exclude config), `__namedExportsOrder`, and underscore-prefixed names
 * are exempt. Files using the legacy `storiesOf` API are exempt.
 *
 * @see Upstream SoT: eslint-plugin-storybook rule `prefer-pascal-case` —
 *   https://github.com/storybookjs/storybook/blob/v10.4.6/code/lib/eslint-plugin/src/rules/prefer-pascal-case.ts
 *
 * Reimplemented from eslint-plugin-storybook@10.4.6. The PascalCase test
 * (`/^[A-Z]+([a-z0-9]?)+/`) and the `toPascalCase` transform mirror upstream.
 *
 * Resync: when bumping the pinned Storybook version or CSF conventions, re-read
 * the upstream rule and reconcile behavior here. Intentional deviation: the
 * upstream autofix renames the export identifier AND all of its references via
 * eslint scope analysis (`ASTUtils.findVariable`). The oxlint JS plugin API does
 * not expose scope managers, so this rule reports only (detection, no fix);
 * references are left for the author to update.
 */

// NOTE: Using `any` types because oxlint JS plugin API doesn't have TypeScript definitions yet

import {
  getDescriptor,
  getMetaObjectExpression,
  isExportStory,
  isStoriesOfImportSpecifier,
  type IncludeExcludeOptions,
} from './utils.ts'

const isPascalCase = (str: string): boolean => /^[A-Z]+([a-z0-9]?)+/.test(str)

/** oxlint rule: named story exports should use PascalCase */
export const preferPascalCaseRule = {
  meta: {
    type: 'suggestion' as const,
    docs: {
      description: 'Stories should use PascalCase',
      recommended: false,
    },
    messages: {
      usePascalCase: 'The story should use PascalCase notation: {{name}}',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context: any) {
    let program: any = null
    let nonStoryExportsConfig: IncludeExcludeOptions = {}
    const namedExports: any[] = []
    let hasStoriesOfImport = false

    const checkAndReportError = (id: any) => {
      const name = id.name
      if (isExportStory({ key: name, config: nonStoryExportsConfig }) === false || name === '__namedExportsOrder') {
        return
      }

      if (name.startsWith('_') === false && isPascalCase(name) === false) {
        context.report({ node: id, messageId: 'usePascalCase', data: { name } })
      }
    }

    return {
      Program(node: any) {
        program = node
      },
      ImportSpecifier(node: any) {
        if (isStoriesOfImportSpecifier(node) === true) hasStoriesOfImport = true
      },
      ExportDefaultDeclaration(node: any) {
        const meta = getMetaObjectExpression({ node, program })
        if (meta !== null) {
          nonStoryExportsConfig = {
            excludeStories: getDescriptor({ meta, propertyName: 'excludeStories' }),
            includeStories: getDescriptor({ meta, propertyName: 'includeStories' }),
          }
        }
      },
      ExportNamedDeclaration(node: any) {
        if (node.declaration === null || node.declaration === undefined) return

        const decl = node.declaration
        if (decl.type === 'VariableDeclaration') {
          const declaration = decl.declarations[0]
          if (declaration === undefined || declaration === null) return
          if (declaration.id?.type === 'Identifier') namedExports.push(declaration.id)
        }
      },
      'Program:exit'() {
        if (namedExports.length > 0 && hasStoriesOfImport === false) {
          for (const n of namedExports) checkAndReportError(n)
        }
      },
    }
  },
}
