import { type CDPSession, expect } from '@playwright/test'

import { perfTest } from '../fixtures/perfTest.ts'

const getJsHeapUsedSize = async (cdpSession: CDPSession): Promise<number> => {
  const { usedSize } = await cdpSession.send('Runtime.getHeapUsage')
  return usedSize
}

/**
 * @remarks
 * Playwright does not support sending CDP (Chrome DevTools Protocol) commands to different targets other than the main thread.
 * See {@link https://github.com/microsoft/playwright/issues/22992}.
 *
 */
perfTest.describe(
  'Memory usage (main thread)',
  { annotation: { type: 'measurement unit', description: 'bytes' } },
  () => {
    perfTest.beforeEach(async ({ page }) => {
      await page.goto('./')
    })

    perfTest.afterEach(async ({ page, context }, testInfo) => {
      const cdpSession = await context.newCDPSession(page)
      await page.requestGC()
      const measurement = await getJsHeapUsedSize(cdpSession)
      testInfo.annotations.push({ type: 'measurement', description: measurement.toString() })
    })

    perfTest('after startup', async ({ page }) => {
      await expect(page.locator('#run')).toBeVisible()
    })

    perfTest('after adding 1,000 rows', async ({ page }) => {
      await page.locator('#run').click()
      await expect(page.locator('tbody>tr:nth-of-type(1)>td:nth-of-type(2)>a')).toBeVisible()
    })

    perfTest('after adding 10,000 rows', async ({ page }) => {
      await page.locator('#runlots').click()
      await expect(page.locator('tbody>tr:nth-of-type(10000)>td:nth-of-type(2)>a')).toBeVisible()
    })

    perfTest('after updating every 10th row 5 times', async ({ page }) => {
      await page.locator('#run').click()
      for (let i = 0; i < 5; i++) {
        await page.locator('#update').click()
        await expect(page.locator('tbody>tr:nth-of-type(1)>td:nth-of-type(2)>a')).toContainText(' !!!'.repeat(i))
      }
    })

    perfTest('after creating and clearing 1,000 rows 5 times', async ({ page }) => {
      for (let i = 0; i < 5; i++) {
        await page.locator('#run').click()
        await expect(page.locator('tbody>tr:nth-of-type(1000)>td:nth-of-type(1)')).toHaveText(
          (1000 * (i + 1)).toFixed(0),
        )
        await page.locator('#clear').click()
        await expect(page.locator('tbody>tr:nth-of-type(1000)>td:nth-of-type(1)')).not.toBeVisible()
      }
    })
  },
)
