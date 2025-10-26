import { Effect, FastCheck } from '@livestore/utils/effect'
import * as Vitest from './Vitest.ts'

// Demonstrate enhanced asProp functionality with clear shrinking progress
// This showcases the fix for the "Run 26/6" bug and accurate shrinking detection

Vitest.describe('Vitest.asProp', () => {
  const IntArbitrary = FastCheck.integer({ min: 1, max: 100 })

  // Always-passing test - should only show initial phase
  Vitest.asProp(
    Vitest.scopedLive,
    'always-pass test (shows only initial runs)',
    [IntArbitrary],
    (properties, _ctx, enhanced) =>
      Effect.gen(function* () {
        const [value] = properties
        if (value === undefined) {
          return yield* Effect.fail(new Error('Value is undefined'))
        }

        console.log(
          `✅ ALWAYS-PASS [${enhanced._tag.toUpperCase()}]: ` +
            (enhanced._tag === 'initial'
              ? `Run ${enhanced.runIndex + 1}/${enhanced.numRuns}`
              : `Shrink #${enhanced.shrinkAttempt} (finding minimal counterexample)`) +
            `, value=${value}, total=${enhanced.totalExecutions}`,
        )

        // This test always passes, so no shrinking will occur
        return
      }),
    { fastCheck: { numRuns: 4 } },
  )

  // Failing test - should show initial + shrinking phases
  let alreadyFailed = false
  Vitest.asProp(
    Vitest.scopedLive,
    'failing test (shows initial runs + shrinking)',
    [IntArbitrary],
    (properties, ctx, enhanced) =>
      Effect.gen(function* () {
        const [value] = properties
        if (value === undefined) {
          return yield* Effect.fail(new Error('Value is undefined'))
        }

        const displayInfo =
          enhanced._tag === 'initial'
            ? `Run ${enhanced.runIndex + 1}/${enhanced.numRuns}`
            : `Shrink #${enhanced.shrinkAttempt} (finding minimal counterexample)`

        const status = value > 80 ? '💥' : '✅'
        console.log(
          `${status} FAILING-TEST [${enhanced._tag.toUpperCase()}]: ${displayInfo}, value=${value}, total=${enhanced.totalExecutions}`,
        )

        // Fail when value is greater than 80 to trigger shrinking
        if (value > 80) {
          alreadyFailed = true
          return yield* Effect.fail(new Error(`Value ${value} is too large (> 80)`))
        }

        if (alreadyFailed && enhanced._tag === 'shrinking') {
          ctx.skip("For the sake of this test, we don't want to fail but want to skip")
          return
        }

        return
      }),
    { fastCheck: { numRuns: 3 } },
  )

  // Test with endOnFailure: true - should not show shrinking
  Vitest.asProp(
    Vitest.scopedLive,
    'failing test with endOnFailure (no shrinking)',
    [IntArbitrary],
    (properties, _ctx, enhanced) =>
      Effect.gen(function* () {
        const [value] = properties
        if (value === undefined) {
          return yield* Effect.fail(new Error('Value is undefined'))
        }

        console.log(
          `🚫 END-ON-FAILURE [${enhanced._tag.toUpperCase()}]: ` +
            `Run ${enhanced.runIndex + 1}/${enhanced.numRuns}, value=${value}, total=${enhanced.totalExecutions}`,
        )

        // This will fail but shrinking is disabled
        if (value > 50) {
          return yield* Effect.fail(new Error(`Value ${value} is too large (> 50) - but no shrinking!`))
        }

        return
      }),
    {
      fastCheck: {
        numRuns: 5,
        endOnFailure: true,
        // Provide explicit samples so the second run crosses >50. Randomly drawing five
        // integers has ~3% chance to stay ≤ 50, which would break the `fails: true`
        // expectation even though shrinking remains disabled. The examples keep the
        // demo readable while leaving the remaining runs to FastCheck.
        examples: [[5], [66]],
      },
      fails: true,
    },
  )
})
