/**
 * no-non-durable-wait oxlint rule.
 *
 * Bans non-durable `Effect.sleep(...)` / `Effect.timeout(...)` in restate-effect
 * handler code, where they silently break Restate's durable-execution contract.
 *
 * A bare `Effect.sleep` schedules an in-process timer: it does NOT survive
 * invocation suspension or replay. After a crash/suspend the journal is replayed
 * and the in-process wait is simply re-run (or lost), so the handler does not
 * resume where it left off. `Restate.sleep` / `Restate.timeout` instead journal a
 * durable timer that the Restate runtime owns, so the wait survives suspension and
 * replay and the handler resumes deterministically.
 *
 * These are EXEMPT when they appear lexically inside a `Restate.run(...)` (or
 * `ctx.run(...)`) call — the durable-step closure. Restate journals the `run`
 * result once on the first real execution and replays it verbatim, so an
 * `Effect.sleep` inside a `run` is part of a single journaled step, not a
 * handler-level wait that must itself be durable.
 *
 * Unlike `no-raw-nondeterminism`, this rule is about DURABILITY, not determinism:
 * `Effect.sleep`/`Effect.timeout` are perfectly deterministic, they just aren't
 * durable across suspension/replay.
 *
 * @example
 * // ✅ Good - durable wait owned by the Restate runtime
 * yield* Restate.sleep('5 seconds')
 * const result = yield* Restate.timeout(action, '30 seconds')
 *
 * // ✅ Good - inside a journaled durable step
 * yield* Restate.run('poll', Effect.sleep('1 second').pipe(Effect.andThen(poll)))
 *
 * // ❌ Bad - non-durable in-process wait in a handler body
 * yield* Effect.sleep('5 seconds')
 * const result = yield* Effect.timeout(action, '30 seconds')
 */

// NOTE: Using `any` types because oxlint JS plugin API doesn't have TypeScript definitions yet

/**
 * Check whether a CallExpression node is a non-durable wait that should be
 * flagged. Returns the human-readable label of the call, or `undefined` if it is
 * not a tracked source.
 *
 * Tracked: `Effect.sleep(...)`, `Effect.timeout(...)`.
 */
const callExpressionSource = (node: any): string | undefined => {
  const callee = node.callee
  if (callee?.type !== 'MemberExpression') return undefined
  if (callee.computed === true) return undefined

  const object = callee.object
  if (object?.type !== 'Identifier' || object.name !== 'Effect') return undefined

  const propertyName = callee.property?.name
  if (propertyName === 'sleep') return 'Effect.sleep()'
  if (propertyName === 'timeout') return 'Effect.timeout()'

  return undefined
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

/** ESLint rule banning non-durable `Effect.sleep`/`Effect.timeout` outside a journaled `Restate.run` closure */
export const noNonDurableWaitRule = {
  meta: {
    type: 'problem' as const,
    docs: {
      description:
        'Ban non-durable Effect.sleep/Effect.timeout outside a journaled Restate.run closure (use Restate.sleep/Restate.timeout for durable waits)',
      recommended: false,
    },
    messages: {
      nonDurableWait:
        'Non-durable `{{source}}` schedules an in-process timer that does not survive suspension/replay. Use `Restate.sleep`/`Restate.timeout` for a durable wait, or move it inside a journaled `Restate.run(...)` step.',
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
          messageId: 'nonDurableWait',
          data: { source },
        })
      },
    }
  },
}
