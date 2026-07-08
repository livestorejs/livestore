/**
 * no-raw-nondeterminism oxlint rule.
 *
 * Bans raw sources of nondeterminism in restate-effect handler code, where they
 * silently break Restate's deterministic-replay contract:
 *
 * - `Date.now()`
 * - argless `new Date()` (reads wall-clock; `new Date(arg)` is deterministic)
 * - `Math.random()`
 * - `crypto.randomUUID()` / `globalThis.crypto.randomUUID()`
 *
 * These are EXEMPT when they appear lexically inside a `Restate.run(...)` (or
 * `ctx.run(...)`) call — the durable-step closure. Restate journals the `run`
 * result once on the first real execution and replays it verbatim, so any
 * nondeterminism captured inside `run` is reproducible. The lint's job is to keep
 * nondeterminism inside `run` or the journaled `Clock`/`Random`, not to police the
 * inside of a `run` closure.
 *
 * The fix is to read time/random via the journaled sources the handler runtime
 * provides (Effect `Clock` / `Random`, backed by `ctx.date` / `ctx.rand`) or to
 * wrap the raw call in `Restate.run` so its result is journaled.
 *
 * See restate-effect decision 0004 (determinism layer) and requirement R20.
 *
 * @example
 * // ✅ Good - journaled sources
 * const now = yield* Clock.currentTimeMillis
 * const id = yield* Random.nextInt
 *
 * // ✅ Good - wrapped in a journaled durable step
 * const id = yield* Restate.run('gen-id', Effect.sync(() => crypto.randomUUID()))
 *
 * // ❌ Bad - raw nondeterminism in a handler body
 * const now = Date.now()
 * const r = Math.random()
 * const id = crypto.randomUUID()
 * const ts = new Date()
 */

// NOTE: Using `any` types because oxlint JS plugin API doesn't have TypeScript definitions yet

/**
 * Check whether a CallExpression node is a raw nondeterminism source that should
 * be flagged. Returns the human-readable label of the call, or `undefined` if it
 * is not a tracked source.
 *
 * Tracked: `Date.now()`, `Math.random()`, `crypto.randomUUID()`,
 * `globalThis.crypto.randomUUID()`.
 */
const callExpressionSource = (node: any): string | undefined => {
  const callee = node.callee
  if (callee?.type !== 'MemberExpression') return undefined
  if (callee.computed === true) return undefined

  const propertyName = callee.property?.name
  const object = callee.object

  // Date.now()
  if (object?.type === 'Identifier' && object.name === 'Date' && propertyName === 'now') {
    return 'Date.now()'
  }

  // Math.random()
  if (object?.type === 'Identifier' && object.name === 'Math' && propertyName === 'random') {
    return 'Math.random()'
  }

  // crypto.randomUUID() / globalThis.crypto.randomUUID()
  if (propertyName === 'randomUUID' && isCryptoObject(object) === true) {
    return 'crypto.randomUUID()'
  }

  return undefined
}

/** Check whether an object expression refers to `crypto` or `globalThis.crypto`. */
const isCryptoObject = (object: any): boolean => {
  if (object?.type === 'Identifier' && object.name === 'crypto') return true

  // globalThis.crypto
  if (
    object?.type === 'MemberExpression' &&
    object.computed === false &&
    object.object?.type === 'Identifier' &&
    object.object.name === 'globalThis' &&
    object.property?.name === 'crypto'
  ) {
    return true
  }

  return false
}

/** Check whether a NewExpression is an argless `new Date()` (wall-clock read). */
const isArglessNewDate = (node: any): boolean => {
  if (node.callee?.type !== 'Identifier' || node.callee.name !== 'Date') return false
  return node.arguments.length === 0
}

/**
 * Walk up the AST from `node`; return `true` if it is lexically inside a
 * `Restate.run(...)` / `*.run(...)` call's argument list (the durable-step
 * closure), where the result is journaled and replayed verbatim.
 *
 * Matches any `*.run(...)` member call — `Restate.run`, `ctx.run`, etc. — since
 * the durable-step closure is the journaled boundary regardless of the receiver
 * alias.
 */
const isInsideRestateRun = (node: any): boolean => {
  let current = node
  let parent = current.parent

  while (parent !== undefined && parent !== null) {
    if (
      parent.type === 'CallExpression' &&
      isRestateRunCallee(parent.callee) === true &&
      parent.arguments.includes(current) === true
    ) {
      return true
    }

    current = parent
    parent = current.parent
  }

  return false
}

/** Check whether a callee is a `*.run` member expression (e.g. `Restate.run`, `ctx.run`). */
const isRestateRunCallee = (callee: any): boolean =>
  callee?.type === 'MemberExpression' &&
  callee.computed === false &&
  callee.property?.type === 'Identifier' &&
  callee.property.name === 'run'

/** ESLint rule banning raw nondeterminism outside a journaled `Restate.run` closure */
export const noRawNondeterminismRule = {
  meta: {
    type: 'problem' as const,
    docs: {
      description:
        'Ban raw nondeterminism (Date.now, new Date, Math.random, crypto.randomUUID) outside a journaled Restate.run closure',
      recommended: false,
    },
    messages: {
      rawNondeterminism:
        'Raw nondeterminism `{{source}}` breaks Restate deterministic replay. Use the journaled `Clock`/`Random` (backed by `ctx.date`/`ctx.rand`), or wrap it in `Restate.run(...)` so its result is journaled.',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context: any) {
    return {
      CallExpression(node: any) {
        const source = callExpressionSource(node)
        if (source === undefined) return
        if (isInsideRestateRun(node) === true) return

        context.report({
          node,
          messageId: 'rawNondeterminism',
          data: { source },
        })
      },

      NewExpression(node: any) {
        if (isArglessNewDate(node) === false) return
        if (isInsideRestateRun(node) === true) return

        context.report({
          node,
          messageId: 'rawNondeterminism',
          data: { source: 'new Date()' },
        })
      },
    }
  },
}
