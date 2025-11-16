import type { CDPSession } from '@playwright/test'
import { expect } from '@playwright/test'

import { test } from '../fixtures.ts'
import {
  collectStreamingMetrics,
  repeatSuite,
  resetHarness,
  seedTodos,
  startStreaming,
  waitForStreamingCompletion,
} from '../utils.ts'

const REPETITIONS_PER_TEST = 1
const TODO_COUNT = 1_000

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
      await resetHarness(page)
    })

    test('after streaming 1,000 seeded todos', async ({ page, context }, testInfo) => {
      await seedTodos(page, TODO_COUNT)
      await startStreaming(page)
      const statusAfter = await waitForStreamingCompletion(page)
      const metrics = await collectStreamingMetrics(page)

      const cdpSession = await context.newCDPSession(page)
      await page.requestGC()
      const measurement = await getJsHeapUsedSize(cdpSession)

      testInfo.annotations.push({ type: 'measurement', description: measurement.toString() })

      expect(statusAfter.streamedCount).toBe(TODO_COUNT)
      expect(metrics.todos.total).toBe(TODO_COUNT)
      expect(metrics.events.created).toBe(TODO_COUNT)
      expect(metrics.events.total).toBe(TODO_COUNT)
      expect(metrics.status.streamingStatus).toBe('complete')
    })
  },
)
