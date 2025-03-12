import { test as teardown } from '@playwright/test'

teardown('Global Teardown', async ({ browser }) => {
  await teardown.step('Stop tracing (Chromium DevTools)', async () => {
    await browser.stopTracing()
  })
})
