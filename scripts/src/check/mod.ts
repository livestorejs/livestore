import { Effect, Fiber, Option } from '@livestore/utils/effect'
import { Cli } from '@livestore/utils/node'
import { allLintChecks, fastLintChecks } from './checks/lint.ts'
import { allTestChecks, fastTestChecks } from './checks/test.ts'
import { typecheckCheck } from './checks/typecheck.ts'
import type { Check } from './checks/types.ts'
import { CheckEventPubSub } from './events.ts'
import { createOutputRenderer, printSummary } from './output.ts'
import { runCheckWithEvents } from './runner.ts'

// --- All available checks ---

const allChecks: Check[] = [typecheckCheck, ...allLintChecks, ...allTestChecks]

const fastChecks: Check[] = [typecheckCheck, ...fastLintChecks, ...fastTestChecks]

// --- Check resolution ---

type CheckCategory = 'typecheck' | 'lint' | 'test' | 'ts'

const parseCategories = (input: string): CheckCategory[] =>
  input
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is CheckCategory => ['typecheck', 'lint', 'test', 'ts'].includes(s))
    .map((s) => (s === 'ts' ? 'typecheck' : s)) // Alias 'ts' -> 'typecheck'

const resolveChecks = (opts: { full: boolean; skip: Option.Option<string>; only: Option.Option<string> }): Check[] => {
  let checks: Check[]

  // Start with fast or all checks based on --full flag
  if (opts.full) {
    checks = [...allChecks]
  } else {
    checks = [...fastChecks]
  }

  // Apply --only filter
  if (Option.isSome(opts.only)) {
    const categories = parseCategories(opts.only.value)
    checks = checks.filter((check) => categories.includes(check.type as CheckCategory))
  }

  // Apply --skip filter
  if (Option.isSome(opts.skip)) {
    const categories = parseCategories(opts.skip.value)
    checks = checks.filter((check) => !categories.includes(check.type as CheckCategory))
  }

  return checks
}

/**
 * Run a check, wrapping it with event publishing.
 * The check.run effect has unknown context, but we know the CLI provides all required layers.
 */
const executeCheck = (check: Check) =>
  runCheckWithEvents(
    check.type,
    check.name,
    // Cast to void effect - the context is provided by the CLI layers
    check.run as Effect.Effect<void, unknown, never>,
  )

// --- Main check command ---

export const checkCommand = Cli.Command.make(
  'check',
  {
    full: Cli.Options.boolean('full').pipe(
      Cli.Options.withDefault(false),
      Cli.Options.withDescription('Run all checks including slow ones (integration tests, madge)'),
    ),
    skip: Cli.Options.text('skip').pipe(
      Cli.Options.optional,
      Cli.Options.withDescription('Skip checks by category: typecheck,lint,test (comma-separated)'),
    ),
    only: Cli.Options.text('only').pipe(
      Cli.Options.optional,
      Cli.Options.withDescription('Run only checks by category: typecheck,lint,test (comma-separated)'),
    ),
    verbose: Cli.Options.boolean('verbose').pipe(
      Cli.Options.withDefault(false),
      Cli.Options.withDescription('Stream all output as it comes'),
    ),
    failFast: Cli.Options.boolean('fail-fast').pipe(
      Cli.Options.withDefault(false),
      Cli.Options.withDescription('Stop on first failure'),
    ),
  },
  Effect.fn(function* ({ full, skip, only, verbose, failFast }) {
    const startTime = Date.now()
    const isCI = process.env.GITHUB_ACTIONS === 'true' || process.env.CI === 'true'

    // Resolve which checks to run
    const checks = resolveChecks({ full, skip, only })

    if (checks.length === 0) {
      console.log('No checks to run.')
      return
    }

    const checkNames = checks.map((c) => c.name)

    console.log(`Running ${checks.length} check${checks.length > 1 ? 's' : ''}${full ? ' (full)' : ''}...\n`)

    // Create PubSub layer
    const pubsubLayer = CheckEventPubSub.live

    // Run all checks and output renderer concurrently
    const program = Effect.gen(function* () {
      // Start output renderer (scoped to handle queue subscription)
      const rendererFiber = yield* Effect.fork(createOutputRenderer(checkNames, { verbose, isCI }).pipe(Effect.scoped))

      // Run checks concurrently (or fail-fast)
      let results: boolean[]

      if (failFast) {
        // Run checks with fail-fast: stop on first failure
        results = []
        for (const check of checks) {
          const success = yield* executeCheck(check)
          results.push(success)
          if (!success) {
            break // Stop on first failure
          }
        }
      } else {
        // Run all checks concurrently
        results = yield* Effect.forEach(checks, executeCheck, { concurrency: 'unbounded' })
      }

      // Wait for renderer to finish
      const { results: checkStates } = yield* Fiber.join(rendererFiber)

      return { results, checkStates }
    })

    const { results, checkStates } = yield* program.pipe(Effect.provide(pubsubLayer))

    const totalDuration = Date.now() - startTime

    // Print summary
    yield* printSummary(checkStates, totalDuration)

    // Fail if any checks failed
    const anyFailed = results.some((r) => !r)
    if (anyFailed) {
      return yield* Effect.fail(new Error('Some checks failed'))
    }
  }),
).pipe(Cli.Command.withDescription('Run type check, lint, and tests (fast by default, --full for all)'))
