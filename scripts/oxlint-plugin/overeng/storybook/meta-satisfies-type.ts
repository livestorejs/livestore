/**
 * storybook/meta-satisfies-type oxlint rule.
 *
 * The CSF Meta object should use `satisfies Meta<...>` (rather than a type
 * annotation or `as` cast) for type safety.
 *
 * @see Upstream SoT: eslint-plugin-storybook rule `meta-satisfies-type` —
 *   https://github.com/storybookjs/storybook/blob/v10.4.6/code/lib/eslint-plugin/src/rules/meta-satisfies-type.ts
 *
 * Reimplemented from eslint-plugin-storybook@10.4.6.
 *
 * Resync: when bumping the pinned Storybook version or CSF conventions, re-read
 * the upstream rule and reconcile behavior here. Intentional deviation: the
 * upstream autofix rewrites `{} as Meta` / `const meta: Meta = {}` into a
 * `satisfies` form using `sourceCode` parenthesis bookkeeping. That fixer leans
 * on `sourceCode.getText(node, before, after)` offset semantics and
 * `ASTUtils.isParenthesized`, which are not reliable in the oxlint JS plugin
 * runtime, so this rule reports only (detection, no fix).
 */

// NOTE: Using `any` types because oxlint JS plugin API doesn't have TypeScript definitions yet

/** Resolve the top-level `const <name> = <init>` declarator node in a Program body. */
const findTopLevelConstDeclarator = (opts: { program: any; name: string }): any => {
  const { program, name } = opts
  if (program === undefined || program === null) return null
  for (const stmt of program.body) {
    if (stmt.type !== 'VariableDeclaration') continue
    for (const decl of stmt.declarations) {
      if (decl.id?.type === 'Identifier' && decl.id.name === name) return decl
    }
  }
  return null
}

/**
 * Find the Meta ObjectExpression of a default export and whether it is already
 * wrapped in a `satisfies` expression.
 *
 * Handles the direct form (`export default {} satisfies Meta`) and the
 * resolved-const form (`const meta = {} satisfies Meta; export default meta`).
 */
const resolveMeta = (opts: { node: any; program: any }): { object: any; satisfied: boolean } | null => {
  const { node, program } = opts
  let candidate = node.declaration

  if (candidate?.type === 'Identifier') {
    const declarator = findTopLevelConstDeclarator({ program, name: candidate.name })
    candidate = declarator?.init ?? null
  }

  if (candidate === null || candidate === undefined) return null

  if (candidate.type === 'TSSatisfiesExpression') {
    return candidate.expression?.type === 'ObjectExpression' ? { object: candidate.expression, satisfied: true } : null
  }

  if (candidate.type === 'TSAsExpression') {
    return candidate.expression?.type === 'ObjectExpression' ? { object: candidate.expression, satisfied: false } : null
  }

  return candidate.type === 'ObjectExpression' ? { object: candidate, satisfied: false } : null
}

/** oxlint rule: the CSF Meta should use `satisfies Meta` */
export const metaSatisfiesTypeRule = {
  meta: {
    type: 'problem' as const,
    docs: {
      description: 'Meta should use `satisfies Meta`',
      recommended: false,
    },
    messages: {
      metaShouldSatisfyType: 'CSF Meta should use `satisfies` for type safety',
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
        const resolved = resolveMeta({ node, program })
        if (resolved === null) return

        if (resolved.satisfied === false) {
          context.report({ node: resolved.object, messageId: 'metaShouldSatisfyType' })
        }
      },
    }
  },
}
