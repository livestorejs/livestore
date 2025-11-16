import { test as base } from '@playwright/test'

import { shouldRecordPerfProfile } from './utils.ts'

export const test = base.extend<{ forEachTest: undefined }>({
  forEachTest: [
    async ({ page, browser }, use, testInfo) => {
      if (shouldRecordPerfProfile) {
        await browser.startTracing(page, { path: testInfo.outputPath('perf-profile.json') })
      }

      await use()

      if (shouldRecordPerfProfile) {
        await browser.stopTracing()
      }
    },
    { auto: true },
  ],
})
