import { expect } from '@playwright/test'

import { test } from '../fixtures.ts'
import {
  collectStreamingMetrics,
  configureGenerator,
  repeatSuite,
  resetHarness,
  seedTodos,
  startGenerator,
  startStreaming,
  waitForStreamingCompletion,
} from '../utils.ts'

const REPETITIONS_PER_TEST = 15
const TODO_COUNT = 1_000

repeatSuite(
  'Streaming latency',
  REPETITIONS_PER_TEST,
  {
    annotation: [{ type: 'measurement unit', description: 'ms' }],
  },
  () => {
    test.beforeEach(async ({ page }) => {
      await resetHarness(page)
    })

    test('for pre-seeded backlog of 1,000 todos', async ({ page }, testInfo) => {
      await seedTodos(page, TODO_COUNT)
      await startStreaming(page)

      const statusAfter = await waitForStreamingCompletion(page)
      const metrics = await collectStreamingMetrics(page)

      testInfo.annotations.push({ type: 'measurement', description: metrics.duration.toString() })

      expect(statusAfter.streamedCount).toBe(TODO_COUNT)
      expect(metrics.todos.total).toBe(TODO_COUNT)
      expect(metrics.events.created).toBe(TODO_COUNT)
      expect(metrics.events.total).toBe(TODO_COUNT)
      expect(metrics.status.streamingStatus).toBe('complete')
    })

    test('for live generation of 1,000 todos @ 500 eps', async ({ page }, testInfo) => {
      await configureGenerator(page, { total: TODO_COUNT, eventsPerSecond: 500 })

      await startStreaming(page)
      await startGenerator(page)

      const statusAfter = await waitForStreamingCompletion(page)
      const metrics = await collectStreamingMetrics(page)

      testInfo.annotations.push({ type: 'measurement', description: metrics.duration.toString() })

      expect(statusAfter.streamedCount).toBe(TODO_COUNT)
      expect(metrics.todos.total).toBe(TODO_COUNT)
      expect(metrics.events.created).toBe(TODO_COUNT)
      expect(metrics.events.total).toBe(TODO_COUNT)
      expect(metrics.status.streamingStatus).toBe('complete')
    })
  },
)
