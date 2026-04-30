import type { Page, TestDetails } from '@playwright/test'

import { test } from './fixtures.ts'

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
    if (shouldRecordPerfProfile === true) {
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

export const assertPerfAppReady = async (page: Page): Promise<void> => {
  try {
    await page.locator('#create1k').waitFor({ state: 'visible', timeout: 8000 })
  } catch {
    const bodyText = await page
      .locator('body')
      .innerText()
      .catch(() => '<body unavailable>')
    throw new Error(
      `Perf test app did not become ready (expected #create1k). Current body text: ${bodyText.slice(0, 200)}`,
    )
  }
}
