import { expect } from '@playwright/test'

import { test } from '../fixtures.ts'

const TODO_COUNT = 1_000

test.describe(
  'Loopback streaming latency',
  {
    annotation: [{ type: 'measurement unit', description: 'ms' }],
  },
  () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/')
      const control = page.getByTestId('generator-status')
      await expect(control).toBeVisible()
      const resetButton = page.getByTestId('reset-harness')
      await expect(resetButton).toBeEnabled()
      await resetButton.click()
      await expect(control).toHaveAttribute('data-flush-status', 'idle')
      await expect(control).toHaveAttribute('data-generator-status', 'idle')
      await expect(control).toHaveAttribute('data-queue-length', '0')
      await expect(page.getByTestId('todo-count-meta')).toContainText('0')
    })

    test('streams 1,000 seeded events', async ({ page }, testInfo) => {
      const control = page.getByTestId('generator-status')

      await page.getByTestId('seed-1k').click()
      await expect(control).toHaveAttribute('data-seeded-count', TODO_COUNT.toString())
      await expect(control).toHaveAttribute('data-queue-length', TODO_COUNT.toString())

      const startButton = page.getByTestId('start-stream')
      await expect(startButton).toBeEnabled()
      await startButton.click()
      await expect(control).toHaveAttribute('data-flush-status', 'running')

      await expect(control).toHaveAttribute('data-flush-status', 'complete', { timeout: 60_000 })
      await expect(control).toHaveAttribute('data-queue-length', '0')
      await expect(control).toHaveAttribute('data-generator-status', 'idle')

      const duration = await page.evaluate(() => {
        const start = (window as any).__streamPerfStart ?? performance.now()
        delete (window as any).__streamPerfStart
        return performance.now() - start
      })
      const todoText = await page.getByTestId('todo-count-meta').textContent()
      const todoCount = todoText && /[0-9]/.test(todoText) ? Number.parseInt(todoText.replace(/[^0-9]/g, ''), 10) : 0

      testInfo.annotations.push({ type: 'measurement', description: duration.toString() })

      expect(todoCount).toBe(TODO_COUNT)
      expect(duration).toBeGreaterThan(0)
    })
  },
)

test.describe(
  'Loopback streaming memory (main thread)',
  {
    annotation: [{ type: 'measurement unit', description: 'bytes' }],
  },
  () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/')
      const control = page.getByTestId('generator-status')
      await expect(control).toBeVisible()
      const resetButton = page.getByTestId('reset-harness')
      await expect(resetButton).toBeEnabled()
      await resetButton.click()
      await expect(control).toHaveAttribute('data-flush-status', 'idle')
      await expect(control).toHaveAttribute('data-generator-status', 'idle')
      await expect(control).toHaveAttribute('data-queue-length', '0')
      await expect(page.getByTestId('todo-count-meta')).toContainText('0')
    })

    test('heap delta after streaming 1,000 seeded events', async ({ page, context }, testInfo) => {
      const control = page.getByTestId('generator-status')

      await page.getByTestId('seed-1k').click()
      await expect(control).toHaveAttribute('data-seeded-count', TODO_COUNT.toString())
      await expect(control).toHaveAttribute('data-queue-length', TODO_COUNT.toString())

      const cdpSession = await context.newCDPSession(page)
      await page.requestGC()
      const { usedSize: heapBefore } = await cdpSession.send('Runtime.getHeapUsage')

      const startButton = page.getByTestId('start-stream')
      await expect(startButton).toBeEnabled()
      await startButton.click()
      await expect(control).toHaveAttribute('data-flush-status', 'running')

      await expect(control).toHaveAttribute('data-flush-status', 'complete', { timeout: 60_000 })
      await expect(control).toHaveAttribute('data-queue-length', '0')
      await expect(control).toHaveAttribute('data-generator-status', 'idle')

      await page.requestGC()
      const { usedSize: heapAfter } = await cdpSession.send('Runtime.getHeapUsage')
      await cdpSession.detach()

      const heapDelta = heapAfter - heapBefore
      const todoText = await page.getByTestId('todo-count-meta').textContent()
      const todoCount = todoText && /[0-9]/.test(todoText) ? Number.parseInt(todoText.replace(/[^0-9]/g, ''), 10) : 0

      testInfo.annotations.push({ type: 'measurement', description: heapDelta.toString() })

      expect(todoCount).toBe(TODO_COUNT)
      expect(heapAfter).toBeGreaterThan(0)
    })
  },
)
