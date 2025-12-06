import { fileURLToPath } from 'node:url'
import { expect, type Page } from '@playwright/test'
import { test } from '../fixtures.ts'

test.describe('Streaming latency', () => {
  test('stream 1.000 events', async ({ page }, _testInfo) => {
    await test.step('prepare', async () => {
      await page.goto('/')
      await page.getByTestId('reset-harness').click()
      await expect(page.getByTestId('app')).toBeVisible()
      await page.getByTestId('seed-1k').click()
      await expect(page.getByTestId('syncstate')).toHaveText('Synced', { timeout: 60000 })
      await page.requestGC()
    })

    await test.step('warmup', async () => {
      const startTime = Date.now()
      await page.getByTestId('toggle-events').click()
      await expect(page.getByTestId('events-streamed')).toHaveText('1000', { timeout: 60000 })
      const duration = Date.now() - startTime
      console.log(`[COLD]: Streamed 1K events in ${duration}ms`)
    })

    await test.step('run', async () => {
      await page.reload()
      const startTime = Date.now()
      await page.getByTestId('toggle-events').click()
      await expect(page.getByTestId('events-streamed')).toHaveText('1000', { timeout: 60000 })
      const duration = Date.now() - startTime
      console.log(`[WARM]: Streamed 1K events in ${duration}ms`)
    })
  })
})

test.describe('Snapshot streaming tests', () => {
  /**
   * We currently skip these tests. To run them we need to have snapshots of 10K
   * and 100K events in the snapshots folder but we don't want to keep those in
   * the repository. Currently they are generated manually via LiveStore
   * devtools export utility, one for state and one for eventlog for each event
   * count. A future improvement is to create a script that generates the snapshots
   * automatically if they are not present of via a comman.
   */
  const SNAPSHOT_EVENT_COUNTS = [10_000, 100_000] as const
  const STREAM_BATCH_SIZES = [10, 100, 256, 1000] as const
  const STREAM_BATCH_ITERATIONS = 10

  SNAPSHOT_EVENT_COUNTS.forEach((eventCount) => {
    test.skip(`stream snapshots (${eventCount.toLocaleString()} events)`, async ({ page }) => {
      await prepareSnapshots(page, eventCount)
      const startTime = Date.now()
      await streamEvents(page, eventCount)
      const duration = Date.now() - startTime
      console.log(`[DURATION]: Streamed ${eventCount} events in ${duration}ms`)
    })
  })

  /**
   * This test is mainly useful as an optimization tool in order
   * to determine the optimal batchSize setting.
   */
  test.skip('stream snapshot batch size sweep (10,000 events)', async ({ page }) => {
    const eventCount = 10_000
    await prepareSnapshots(page, eventCount)

    for (const batchSize of STREAM_BATCH_SIZES) {
      await test.step(`batch size ${batchSize}`, async () => {
        const durations: number[] = []
        for (let iteration = 0; iteration < STREAM_BATCH_ITERATIONS; iteration += 1) {
          await page.reload()
          await expect(page.getByTestId('app')).toBeVisible()
          await expect(page.getByTestId('syncstate')).toHaveText('Synced', { timeout: 60_000 })

          const batchInput = page.getByTestId('config-batch')
          await batchInput.fill(String(batchSize))

          await page.requestGC()
          const startTime = Date.now()
          await page.getByTestId('toggle-events').click()
          await expect(page.getByTestId('events-streamed')).toHaveText(String(eventCount), { timeout: 60_000 })
          durations.push(Date.now() - startTime)
        }

        const averageDuration = calculateAverage(durations)
        const medianDuration = calculateMedian(durations)
        console.log(
          `[BATCH ${batchSize}]: ${STREAM_BATCH_ITERATIONS} iterations avg=${averageDuration.toFixed(2)}ms median=${medianDuration.toFixed(2)}ms durations=[${durations.join(', ')}]`,
        )
      })
    }
  })
})

/**
 * Utitlity functions for loading snapshots
 */

const formatSnapshotCount = (count: number) => count.toLocaleString('en-US').replace(/,/g, '_')

const getSnapshotPaths = (count: number) => {
  const formatted = formatSnapshotCount(count)
  const root = '../snapshots'

  return {
    state: fileURLToPath(new URL(`${root}/state-${formatted}.db`, import.meta.url)),
    eventlog: fileURLToPath(new URL(`${root}/eventlog-${formatted}.db`, import.meta.url)),
  }
}

const loadSnapshots = async (page: Page, count: number) => {
  const { state, eventlog } = getSnapshotPaths(count)
  await page.setInputFiles('[data-testid="snapshot-state-input"]', state)
  await page.setInputFiles('[data-testid="snapshot-eventlog-input"]', eventlog)
  await page.getByTestId('load-snapshots').click()
  await page.waitForFunction(
    () => document.body.innerText.includes('LiveStore Shutdown due to devtools import'),
    undefined,
    { timeout: 60_000 },
  )
}

const prepareSnapshots = async (page: Page, eventCount: number) => {
  await page.goto('/')
  await page.getByTestId('reset-harness').click()
  await expect(page.getByTestId('app')).toBeVisible()

  await loadSnapshots(page, eventCount)
  await page.reload()
  await page.requestGC()
}

const streamEvents = async (page: Page, eventCount: number) => {
  await page.getByTestId('toggle-events').click()
  await expect(page.getByTestId('events-streamed')).toHaveText(String(eventCount), {
    timeout: 60_000,
  })
}

const calculateAverage = (values: number[]): number => {
  if (values.length === 0) {
    return 0
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length
}

const calculateMedian = (values: number[]): number => {
  if (values.length === 0) {
    return 0
  }

  const sorted = [...values].sort((a, b) => a - b)
  const middleIndex = Math.floor(sorted.length / 2)

  if (sorted.length % 2 === 0) {
    const lower = sorted[middleIndex - 1]
    const upper = sorted[middleIndex]
    if (lower === undefined || upper === undefined) {
      return 0
    }
    return (lower + upper) / 2
  }

  return sorted[middleIndex] ?? 0
}
