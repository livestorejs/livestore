import { expect } from '@playwright/test'
import { test } from '../fixtures.ts'

test.describe('Streaming latency', () => {
  test('stream 500 events', async ({ page }) => {
    await test.step('prepare', async () => {
      await page.goto('/')
      await page.getByTestId('reset-harness').click()
      await expect(page.getByTestId('app')).toBeVisible()
      await page.getByTestId('seed-500').click()
      await expect(page.getByTestId('syncstate')).toHaveText('Synced', { timeout: 30000 })
      await page.requestGC()
    })

    await test.step('warmup', async () => {
      const startTime = Date.now()
      await page.getByTestId('toggle-events').click()
      await expect(page.getByTestId('events-streamed')).toHaveText('500', { timeout: 60000 })
      const duration = Date.now() - startTime
      console.log(`[COLD]: Streamed 500 events in ${duration}`)
    })

    await test.step('run', async () => {
      await page.reload()
      const startTime = Date.now()
      await page.getByTestId('toggle-events').click()
      await expect(page.getByTestId('events-streamed')).toHaveText('500', { timeout: 60000 })
      const duration = Date.now() - startTime
      console.log(`[WARM]: Streamed 500 events in ${duration}`)
    })
  })
})
