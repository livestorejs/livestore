import { test as base } from '@playwright/test'
import { shouldRecordPerfProfile } from './utils.js'

// We use a global beforeEach/afterEach instead of a global setup/teardown because the latter can't share a browser context
export const test = base.extend<{ forEachTest: void }>({
  forEachTest: [
    async ({ page, browser }, use, testInfo) => {
      // This code runs before every test.
      if (shouldRecordPerfProfile) {
        await browser.startTracing(page, { path: testInfo.outputPath('perf-profile.json') })
      }

      // Run the test
      await use()

      // This code runs after every test.
      if (shouldRecordPerfProfile) {
        await browser.stopTracing()
      }
    },
    { auto: true },
  ],
})
