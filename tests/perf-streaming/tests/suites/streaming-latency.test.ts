import { expect } from '@playwright/test'

import { test } from '../fixtures.ts'
import { repeatSuite } from '../utils.ts'

const REPETITIONS_PER_TEST = 15

repeatSuite(
  'Streaming latency',
  REPETITIONS_PER_TEST,
  {
    annotation: [{ type: 'measurement unit', description: 'ms' }],
  },
  () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/')
      const clearButton = page.locator('[data-testid="clear-run"]')
      if (await clearButton.isEnabled()) {
        await clearButton.click()
      }
    })

    test('for streaming 1,000 events', async ({ page }, testInfo) => {
      await page.evaluate(() => {
        ;(window as any).__streamPerfStart = performance.now()
      })

      await page.locator('[data-testid="emit-default"]').click()

      const expectedHandle = await page.waitForFunction(() => {
        const expectedEl = document.querySelector('[data-testid="expected-events"]')
        const countEl = document.querySelector('[data-testid="event-count"]')
        const lastSeqEl = document.querySelector('[data-testid="last-sequence"]')

        if (!expectedEl || !countEl || !lastSeqEl) {
          return undefined
        }

        const expectedAttr = expectedEl.getAttribute('data-expected')
        const countAttr = countEl.getAttribute('data-count')
        const lastSeqAttr = lastSeqEl.getAttribute('data-sequence')

        if (expectedAttr === null || countAttr === null || lastSeqAttr === null) {
          return undefined
        }

        const expected = Number(expectedAttr)
        const count = Number(countAttr)
        const lastSeq = Number(lastSeqAttr)

        if (Number.isNaN(expected) || Number.isNaN(count) || Number.isNaN(lastSeq)) {
          return undefined
        }

        return count === expected && lastSeq === expected ? expected : undefined
      })
      const expectedEvents = await expectedHandle.jsonValue()
      if (typeof expectedEvents !== 'number') {
        throw new Error('Expected events count was not resolved')
      }

      const measurement = await page.evaluate(() => {
        const start = (window as any).__streamPerfStart as number | undefined
        const duration = start !== undefined ? performance.now() - start : Number.NaN
        delete (window as any).__streamPerfStart
        return duration
      })

      if (Number.isNaN(measurement)) {
        throw new Error('Failed to capture streaming latency measurement')
      }

      testInfo.annotations.push({ type: 'measurement', description: measurement.toString() })
      await expect(page.locator('[data-testid="event-count"]').first()).toHaveAttribute(
        'data-count',
        expectedEvents.toString(),
      )
    })
  },
)
