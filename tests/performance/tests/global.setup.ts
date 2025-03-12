import { test as setup } from '@playwright/test';

setup('Global Setup', async ({ browser, page }, testInfo) => {
  await setup.step('Start tracing (Chromium DevTools)', async () => {
    await browser.startTracing(page, { path: `${testInfo.outputPath()}-trace.json` })
  })
});
