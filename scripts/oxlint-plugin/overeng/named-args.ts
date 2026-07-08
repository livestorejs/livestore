/**
 * named-args oxlint rule.
 *
 * Enforce functions have at most one parameter (use options objects).
 *
 * This encourages the "options object" pattern for functions with multiple inputs,
 * improving readability, maintainability, and making parameter order irrelevant.
 *
 * The rule is smart about what it checks:
 * - Only checks user-defined functions, not callbacks passed to other functions
 * - Allows rest parameters (...args) as they're conceptually "one thing"
 * - Ignores inline arrow functions passed as arguments (callbacks)
 *
 * For legitimate multi-param cases (interface implementations, API compatibility),
 * use: // oxlint-disable-next-line overeng/named-args -- reason
 *
 * @example
 * // ✅ Good - single parameter
 * export const greet = (name) => `Hello, ${name}`
 *
 * // ✅ Good - options object pattern
 * export const createUser = ({ name, email, age }) => { ... }
 *
 * // ✅ Good - rest parameters allowed
 * export const log = (msg, ...args) => console.log(msg, ...args)
 *
 * // ✅ Good - callbacks are exempt
 * items.map((item, index) => ...)
 *
 * // ❌ Bad - multiple params on user-defined function
 * export const add = (a, b) => a + b  // Use: add = ({ a, b }) => a + b
 */

// NOTE: Using `any` types because oxlint JS plugin API doesn't have TypeScript definitions yet

/** Count non-rest parameters in a function. */
const countNonRestParams = (params: any[]): number => {
  if (params.length === 0) return 0
  const lastParam = params[params.length - 1]
  if (lastParam.type === 'RestElement') {
    return params.length - 1
  }
  return params.length
}

/**
 * Check if this function is a callback (inline function passed as argument or in callback context).
 * These are exempt because they often need to match external API signatures.
 */
const isCallback = (node: any): boolean => {
  const parent = node.parent
  if (parent === undefined) return false

  if (parent.type === 'CallExpression') {
    if (parent.arguments.includes(node) === true) return true
    if (parent.callee === node) return true
  }

  if (parent.type === 'NewExpression') {
    return parent.arguments.includes(node)
  }

  if (parent.type === 'Property' && parent.value === node) {
    const objectExpr = parent.parent
    if (objectExpr?.type === 'ObjectExpression') {
      const grandparent = objectExpr.parent
      if (grandparent?.type === 'CallExpression' && grandparent.arguments.includes(objectExpr) === true) {
        return true
      }
      if (grandparent?.type === 'NewExpression' && grandparent.arguments.includes(objectExpr) === true) {
        return true
      }
    }
  }

  return false
}

/**
 * Check if this is an Effect.gen generator function pattern.
 * Effect.gen(function* (_) { ... }) - the adapter param is idiomatic.
 */
const isEffectGenAdapter = (node: any): boolean => {
  if (node.type !== 'FunctionExpression' || node.generator === false) return false
  if (node.params.length !== 1) return false

  const param = node.params[0]
  if (param.type !== 'Identifier' || param.name !== '_') return false

  const parent = node.parent
  if (parent?.type !== 'CallExpression') return false

  const callee = parent.callee
  if (callee?.type !== 'MemberExpression') return false
  if (callee.property?.name !== 'gen') return false

  return true
}

/**
 * Check if this function is passed to Effect's dual() function.
 * F.dual(2, (self, name) => ...) or Function.dual(2, fn)
 *
 * Dual functions intentionally have multiple parameters to support
 * both curried and direct calling styles.
 */
const isEffectDualFunction = (node: any): boolean => {
  const parent = node.parent
  if (parent?.type !== 'CallExpression') return false

  // Check if this function is the second argument (the implementation)
  const args = parent.arguments
  if (args.length < 2) return false
  if (args[1] !== node) return false

  const callee = parent.callee

  // Check for F.dual or Function.dual (member expression)
  if (callee?.type === 'MemberExpression') {
    const property = callee.property
    if (property?.type === 'Identifier' && property.name === 'dual') {
      // Check object is F, Function, or similar
      const obj = callee.object
      if (obj?.type === 'Identifier') {
        // Common aliases: F, Function, Fn
        if (['F', 'Function', 'Fn'].includes(obj.name) === true) return true
      }
    }
  }

  // Check for imported dual function called directly
  if (callee?.type === 'Identifier' && callee.name === 'dual') {
    return true
  }

  return false
}

/** Get a human-readable description of where the function is defined. */
const getFunctionContext = (node: any): string => {
  if (node.type === 'FunctionDeclaration' && node.id?.name !== undefined) {
    return `function '${node.id.name}'`
  }

  const parent = node.parent

  if (parent?.type === 'VariableDeclarator' && parent.id?.type === 'Identifier') {
    return `function '${parent.id.name}'`
  }

  if (parent?.type === 'Property' && parent.key?.type === 'Identifier') {
    return `method '${parent.key.name}'`
  }

  if (parent?.type === 'MethodDefinition' && parent.key?.type === 'Identifier') {
    return `method '${parent.key.name}'`
  }

  return 'function'
}

/** ESLint rule enforcing functions use named arguments instead of positional parameters */
export const namedArgsRule = {
  meta: {
    type: 'suggestion' as const,
    docs: {
      description: 'Enforce functions use named arguments (options objects) instead of positional parameters',
      recommended: false,
    },
    messages: {
      tooManyParams:
        '{{context}} has {{count}} parameters. Consider using named arguments: ({ param1, param2 }) => ...',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context: any) {
    const checkFunction = (node: any) => {
      if (isCallback(node) === true) return
      if (isEffectGenAdapter(node) === true) return
      if (isEffectDualFunction(node) === true) return

      const nonRestCount = countNonRestParams(node.params)
      if (nonRestCount <= 1) return

      context.report({
        node,
        messageId: 'tooManyParams',
        data: {
          context: getFunctionContext(node),
          count: nonRestCount,
        },
      })
    }

    return {
      FunctionDeclaration: checkFunction,
      FunctionExpression: checkFunction,
      ArrowFunctionExpression: checkFunction,
    }
  },
}
