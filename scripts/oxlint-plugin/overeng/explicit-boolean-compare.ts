/**
 * explicit-boolean-compare oxlint rule.
 *
 * Enforce explicit boolean-literal comparisons in condition positions.
 * This is the inverse of the standard `typescript/no-unnecessary-boolean-literal-compare` rule.
 *
 * Conditions in `if`, `while`, `do-while`, `for`, and ternary expressions
 * must use explicit comparisons rather than relying on implicit truthiness coercion.
 *
 * Auto-fix is provided conservatively for known boolean-returning call expressions
 * (e.g. `.includes()`, `.test()`, `Option.isSome()`, `isFoo()`). Other patterns
 * (plain identifiers, member access, optional chaining) are not auto-fixed because
 * the correct comparison depends on the expression's type (boolean vs nullable vs string).
 *
 * TODO: Type-aware auto-fix would let us fix all cases correctly.
 * OXC JS plugins don't currently expose TypeScript type information.
 * See: https://github.com/oxc-project/oxc/discussions/10342
 *
 * @example
 * // ✅ Good - explicit comparisons
 * if (isReady === true) {}
 * if (isReady === false) {}
 * if (count > 0) {}
 * if (value !== null) {}
 * if (isReady === true && count > 0) {}
 * while (running === true) {}
 * const result = enabled === true ? 'yes' : 'no'
 *
 * // ❌ Bad - implicit boolean coercion
 * if (isReady) {}
 * if (!isReady) {}
 * if (getValue()) {}
 * while (running) {}
 * const result = enabled ? 'yes' : 'no'
 *
 * See: https://github.com/overengineeringstudio/effect-utils/issues/219
 */

const COMPARISON_OPERATORS = new Set(['===', '!==', '==', '!=', '<', '>', '<=', '>=', 'instanceof', 'in'])

/**
 * Method names known to always return boolean.
 * Used for conservative auto-fix: only auto-fix call expressions where
 * we can be confident the return type is boolean.
 */
const KNOWN_BOOLEAN_METHODS = new Set([
  'includes', // String.prototype.includes, Array.prototype.includes
  'startsWith', // String.prototype.startsWith
  'endsWith', // String.prototype.endsWith
  'test', // RegExp.prototype.test
  'has', // Map.prototype.has, Set.prototype.has
  'every', // Array.prototype.every
  'some', // Array.prototype.some
])

/** Check if a name follows boolean naming convention (is*, has*) */
const isBooleanNamingConvention = (name: string): boolean => /^(is|has)[A-Z]/.test(name)

/**
 * Check if an expression is known to return boolean based on AST patterns alone.
 *
 * Without type information this is necessarily a conservative heuristic — only
 * well-known method names and the `is*`/`has*` naming convention are recognized.
 * Notably, plain identifiers, member access, and optional chaining are excluded.
 */
const isKnownBooleanExpression = (node: any): boolean => {
  if (node.type !== 'CallExpression') return false

  const callee = node.callee

  // obj.method(...) — check method name
  if (callee.type === 'MemberExpression' && callee.property?.name !== undefined) {
    const name = callee.property.name
    if (KNOWN_BOOLEAN_METHODS.has(name) === true) return true
    if (isBooleanNamingConvention(name) === true) return true
  }

  // func(...) — check function name
  if (callee.type === 'Identifier' && isBooleanNamingConvention(callee.name) === true) return true

  return false
}

/** Check if a node is an explicit comparison or boolean literal (terminal explicit node). */
const isExplicit = (node: any): boolean => {
  if (node === undefined || node === null) return true

  // Comparison operators produce explicit boolean results
  if (node.type === 'BinaryExpression' && COMPARISON_OPERATORS.has(node.operator) === true) return true

  // Boolean literals are explicit
  if (node.type === 'Literal' && typeof node.value === 'boolean') return true

  return false
}

/**
 * Collect all implicitly-coerced sub-expressions within a condition.
 *
 * Recurses through `&&`/`||` logical combinators and `!` negation to find
 * leaf expressions that rely on implicit truthiness coercion.
 */
const collectImplicit = (node: any): any[] => {
  if (node === undefined || node === null) return []

  // Explicit comparison or boolean literal — nothing to flag
  if (isExplicit(node) === true) return []

  // Logical combinators (&&, ||) — check each side independently
  if (node.type === 'LogicalExpression' && (node.operator === '&&' || node.operator === '||')) {
    return [...collectImplicit(node.left), ...collectImplicit(node.right)]
  }

  // Negation (!) — transparent if argument is explicit or logical
  if (node.type === 'UnaryExpression' && node.operator === '!') {
    if (isExplicit(node.argument) === true) return []
    if (
      node.argument.type === 'LogicalExpression' &&
      (node.argument.operator === '&&' || node.argument.operator === '||')
    ) {
      return collectImplicit(node.argument)
    }
    // !identifier, !callExpr, etc. — flag the whole !expr
    return [node]
  }

  // import.meta.main — idiomatic Bun/Deno entry-point guard, always boolean
  if (node.type === 'MemberExpression' && node.property?.name === 'main' && node.object?.type === 'MetaProperty') {
    return []
  }

  // Everything else (identifier, call, member, etc.) — implicit
  return [node]
}

/** ESLint rule enforcing explicit boolean comparisons in condition positions */
export const explicitBooleanCompareRule = {
  meta: {
    type: 'suggestion' as const,
    fixable: 'code' as const,
    docs: {
      description: 'Enforce explicit boolean-literal comparisons in condition positions (if, while, for, ternary)',
      recommended: false,
    },
    messages: {
      implicitBooleanCondition:
        'Avoid implicit boolean coercion. Use an explicit comparison (e.g. `=== true`, `=== false`, `!== null`).',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context: any) {
    /**
     * Build a fix function for known boolean-returning expressions.
     *
     * For `!expr` where expr is a known boolean call, produces `expr === false`.
     * NOTE: `=== false` is only correct when the expression actually returns `boolean`.
     * For nullable types (`T | undefined`), the correct fix would be `=== undefined` or
     * `=== null`, but without type information we can't distinguish these cases.
     * This is the primary motivation for wanting type-aware auto-fix support.
     */
    const makeFix = (node: any): ((fixer: any) => any) | undefined => {
      // !expr → expr === false (only for known boolean expressions)
      if (node.type === 'UnaryExpression' && node.operator === '!') {
        if (isKnownBooleanExpression(node.argument) === false) return undefined
        return (fixer: any) => {
          const argText = context.sourceCode.getText(node.argument)
          return fixer.replaceText(node, `${argText} === false`)
        }
      }

      // expr → expr === true (only for known boolean expressions)
      if (isKnownBooleanExpression(node) === false) return undefined
      return (fixer: any) => {
        const text = context.sourceCode.getText(node)
        return fixer.replaceText(node, `${text} === true`)
      }
    }

    const checkTest = (test: any) => {
      if (test === undefined || test === null) return
      for (const node of collectImplicit(test)) {
        context.report({
          node,
          messageId: 'implicitBooleanCondition',
          fix: makeFix(node),
        })
      }
    }

    return {
      IfStatement(node: any) {
        checkTest(node.test)
      },
      WhileStatement(node: any) {
        checkTest(node.test)
      },
      DoWhileStatement(node: any) {
        checkTest(node.test)
      },
      ForStatement(node: any) {
        checkTest(node.test)
      },
      ConditionalExpression(node: any) {
        checkTest(node.test)
      },
    }
  },
}
