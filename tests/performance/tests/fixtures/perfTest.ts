import { test as base } from '@playwright/test'

// We use a global beforeEach/afterEach because a global setup/teardown can't share a browser context
export const perfTest = base.extend<{ forEachTest: void }>({
  forEachTest: [
    async ({ page, browser }, use, testInfo) => {
      // This code runs before every test.
      await browser.startTracing(page, { path: testInfo.outputPath('perf-trace-profile.json') })

      // Run the test
      await use()

      // This code runs after every test.
      await browser.stopTracing()
    },
    { auto: true },
  ],
})
