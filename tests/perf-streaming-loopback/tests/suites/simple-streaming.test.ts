import { expect, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { test } from '../fixtures.ts'

const SNAPSHOT_EXPECTED_EVENTS = 10_000
const SNAPSHOT_STATE_PATH = fileURLToPath(new URL('../snapshots/state-10_000.db', import.meta.url))
const SNAPSHOT_EVENTLOG_PATH = fileURLToPath(new URL('../snapshots/eventlog-10_000.db', import.meta.url))

const loadSnapshots = async (page: Page) => {
  await page.setInputFiles('[data-testid="snapshot-state-input"]', SNAPSHOT_STATE_PATH)
  await page.setInputFiles('[data-testid="snapshot-eventlog-input"]', SNAPSHOT_EVENTLOG_PATH)
  await page.getByTestId('load-snapshots').click()
  await page.waitForFunction(
    () => document.body.innerText.includes('LiveStore Shutdown due to devtools import'),
    undefined,
    { timeout: 60_000 },
  )
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

  test('stream snapshots (10k events)', async ({ page, cpuProfiler }, _testInfo) => {
    await test.step('prepare', async () => {
      await page.goto('/')
      await page.getByTestId('reset-harness').click()
      await expect(page.getByTestId('app')).toBeVisible()

      await loadSnapshots(page)
      await page.reload()
      await page.requestGC()
    })

    await test.step('run', async () => {
      await cpuProfiler.start('snapshot')
      const startTime = Date.now()
      await page.getByTestId('toggle-events').click()
      await expect(page.getByTestId('events-streamed')).toHaveText(String(SNAPSHOT_EXPECTED_EVENTS), { timeout: 60000 })
      const duration = Date.now() - startTime
      await cpuProfiler.stop('snapshot')
      console.log(`[SNAPSHOT]: Streamed ${SNAPSHOT_EXPECTED_EVENTS} events in ${duration}ms`)
    })
  })
})
