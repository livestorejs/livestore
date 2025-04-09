import { test } from './fixtures.js'
import type { TestDetails } from '@playwright/test'

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
    for (let i = 1; i <= repetitions; i++) {
      test.describe(`Run ${i}/${repetitions}`, suiteCallback)
    }
  })
}
