import { test as base } from '@playwright/test'

export const test = base.extend<{ forEachTest: undefined }>({
  forEachTest: [
    async ({ page, browser }, use, testInfo) => {
      const shouldRecordPerfProfile = process.env.PERF_PROFILER === '1'
      if (shouldRecordPerfProfile) {
        await browser.startTracing(page, { path: testInfo.outputPath('perf-profile.json') })
      }

      await use(undefined)

      if (shouldRecordPerfProfile) {
        await browser.stopTracing()
      }
    },
    { auto: true },
  ],
})
