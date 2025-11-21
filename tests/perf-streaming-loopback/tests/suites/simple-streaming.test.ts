import { fileURLToPath } from 'node:url'
import { expect, type Page } from '@playwright/test'
import { test } from '../fixtures.ts'

const SNAPSHOT_EVENT_COUNTS = [10_000, 100_000] as const
const STREAM_BATCH_SIZES = [1, 10, 100, 1000] as const

test.setTimeout(120_000)

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

test.describe('Streaming latency', () => {
  test('stream 500 events', async ({ page, cpuProfiler }, _testInfo) => {
    await test.step('prepare', async () => {
      await page.goto('/')
      await page.getByTestId('reset-harness').click()
      await expect(page.getByTestId('app')).toBeVisible()
      await page.getByTestId('seed-500').click()
      await expect(page.getByTestId('syncstate')).toHaveText('Synced', { timeout: 30000 })
      await page.requestGC()
    })

    await test.step('warmup', async () => {
      await cpuProfiler.start('cold')
      const startTime = Date.now()
      await page.getByTestId('toggle-events').click()
      await expect(page.getByTestId('events-streamed')).toHaveText('500', { timeout: 60000 })
      const duration = Date.now() - startTime
      await cpuProfiler.stop('streaming')
      console.log(`[COLD]: Streamed 500 events in ${duration}ms`)
    })

    await test.step('run', async () => {
      await page.reload()
      await cpuProfiler.start('warm')
      const startTime = Date.now()
      await page.getByTestId('toggle-events').click()
      await expect(page.getByTestId('events-streamed')).toHaveText('500', { timeout: 60000 })
      const duration = Date.now() - startTime
      await cpuProfiler.stop('streaming')
      console.log(`[WARM]: Streamed 500 events in ${duration}ms`)
    })
  })

  SNAPSHOT_EVENT_COUNTS.forEach((eventCount) => {
    test(`stream snapshots (${eventCount.toLocaleString()} events)`, async ({ page }) => {
      await prepareSnapshots(page, eventCount)
      const startTime = Date.now()
      await streamEvents(page, eventCount)
      const duration = Date.now() - startTime
      console.log(`[DURATION]: Streamed ${eventCount} events in ${duration}ms`)
    })
  })

  test('stream snapshot batch size sweep (10,000 events)', async ({ page }) => {
    const eventCount = 10_000
    await prepareSnapshots(page, eventCount)

    for (const batchSize of STREAM_BATCH_SIZES) {
      await test.step(`batch size ${batchSize}`, async () => {
        await page.reload()
        await expect(page.getByTestId('app')).toBeVisible()
        await expect(page.getByTestId('syncstate')).toHaveText('Synced', { timeout: 60_000 })

        const batchInput = page.getByTestId('config-batch')
        await batchInput.fill(String(batchSize))

        await page.requestGC()
        const startTime = Date.now()
        await page.getByTestId('toggle-events').click()
        await expect(page.getByTestId('events-streamed')).toHaveText(String(eventCount), { timeout: 60_000 })
        const duration = Date.now() - startTime
        console.log(`[BATCH ${batchSize}]: Streamed ${eventCount} events in ${duration}ms`)
      })
    }
  })
})
