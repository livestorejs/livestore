import type { CDPSession, Page } from '@playwright/test'
import { expect } from '@playwright/test'

import { test } from '../fixtures.ts'
import { repeatSuite } from '../utils.ts'

const REPETITIONS_PER_TEST = 1

const getJsHeapUsedSize = async (cdpSession: CDPSession): Promise<number> => {
  const { usedSize } = await cdpSession.send('Runtime.getHeapUsage')
  return usedSize
}

repeatSuite(
  'Streaming memory (main thread)',
  REPETITIONS_PER_TEST,
  {
    annotation: [{ type: 'measurement unit', description: 'bytes' }],
  },
  () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/')
      const clearButton = page.locator('[data-testid="clear-run"]')
      if (await clearButton.isEnabled()) {
        await clearButton.click()
      }
    })

    const waitForStreamCompletion = async (page: Page) => {
      await page.waitForFunction(() => {
        const expectedEl = document.querySelector('[data-testid="expected-events"]')
        const countEl = document.querySelector('[data-testid="event-count"]')
        const lastSeqEl = document.querySelector('[data-testid="last-sequence"]')

        if (!expectedEl || !countEl || !lastSeqEl) {
          return false
        }

        const expectedAttr = expectedEl.getAttribute('data-expected')
        const countAttr = countEl.getAttribute('data-count')
        const lastSeqAttr = lastSeqEl.getAttribute('data-sequence')

        if (expectedAttr === null || countAttr === null || lastSeqAttr === null) {
          return false
        }

        const expected = Number(expectedAttr)
        const count = Number(countAttr)
        const lastSeq = Number(lastSeqAttr)

        if (Number.isNaN(expected) || Number.isNaN(count) || Number.isNaN(lastSeq)) {
          return false
        }

        return expected > 0 && count === expected && lastSeq === expected
      })
    }

    test('after streaming 1,000 events', async ({ page, context }, testInfo) => {
      await page.locator('[data-testid="emit-default"]').click()
      await waitForStreamCompletion(page)
      const expectedAttr = await page.locator('[data-testid="expected-events"]').getAttribute('data-expected')
      const expectedCount = expectedAttr ?? '0'

      const cdpSession = await context.newCDPSession(page)
      await page.requestGC()
      const measurement = await getJsHeapUsedSize(cdpSession)

      testInfo.annotations.push({ type: 'measurement', description: measurement.toString() })
      await expect(page.locator('[data-testid="event-count"]').first()).toHaveAttribute('data-count', expectedCount)
    })
  },
)
