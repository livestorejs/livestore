import type { TestDetails } from '@playwright/test'
import { test } from './fixtures.js'

export const repeatSuite = (
  suiteName: string,
  repetitions: number,
  suiteDetails: TestDetails,
  suiteCallback: () => void,
) => {
  if (repetitions < 1) {
    console.warn(`Skipping suite "${suiteName}" due to 0 repetitions.`)
    test.describe.skip(suiteName, suiteDetails, suiteCallback)
    return
  }

  test.describe(suiteName, suiteDetails, () => {
    if (shouldRecordPerfProfile) {
      console.warn(`Skipping repetitions for suite "${suiteName}" due to performance profiling.`)
      test.describe('Performance Profiling', suiteCallback)
      return
    }

    for (let i = 1; i <= repetitions; i++) {
      test.describe(`Run ${i}/${repetitions}`, suiteCallback)
    }
  })
}

export const shouldRecordPerfProfile = process.env.PERF_PROFILER === '1'
