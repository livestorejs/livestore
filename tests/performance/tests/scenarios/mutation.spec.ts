// src/scenarios/mutationPerformance.ts
import { test, expect } from '@playwright/test'
import { DatabaseSize, generateDatabase } from '../fixtures/dataGenerator.ts'

test.describe('Mutation Performance Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('./')
    await page.waitForFunction(
      () =>
        '__debugLiveStore' in window &&
        typeof window.__debugLiveStore === 'object' &&
        window.__debugLiveStore !== null &&
        '_' in window.__debugLiveStore,
    )
  })

  for (const size of [DatabaseSize.SMALL, DatabaseSize.MEDIUM, DatabaseSize.LARGE]) {
    test(`Mutation performance with ${size} records`, async ({ page }) => {
      const todos = generateDatabase(size)

      await page.evaluate((data) => {
        globalThis.prepareStore(data)
      }, todos)

      // Measure single insert performance
      const insertTime = await page.evaluate(() => {
        performance.mark('insert-start')
        window.runSingleInsert({
          id: 'new-todo-' + Date.now(),
          text: 'New todo item',
          completed: false,
          deleted: null,
        })
        performance.mark('insert-end')
        return performance.measure('insert', 'insert-start', 'insert-end').duration
      })

      // metrics.mutationLatency.record(insertTime, {
      //   'database_size': size.toString(),
      //   'mutation_type': 'insert'
      // })

      // Measure batch update performance
      const updateTime = await page.evaluate(() => {
        performance.mark('update-start')
        window.runBatchUpdate()
        performance.mark('update-end')
        return performance.measure('update', 'update-start', 'update-end').duration
      })

      // metrics.mutationLatency.record(updateTime, {
      //   'database_size': size.toString(),
      //   'mutation_type': 'batch_update'
      // })

      // Measure mutation throughput
      const throughputResult = await page.evaluate(() => {
        return window.measureMutationThroughput(1000) // 1 second test
      })

      // metrics.mutationThroughput.add(throughputResult.mutationsPerSecond, {
      //   'database_size': size.toString()
      // })

      // Check main thread blocking during batch operations
      const blockingTime = await page.evaluate(() => {
        return window.measureMainThreadBlocking(() => {
          window.runLargeBatchOperation()
        })
      })

      // metrics.mainThreadBlocking.record(blockingTime, {
      //   'database_size': size.toString(),
      //   'operation_type': 'batch_mutation'
      // })

      expect(insertTime).toBeGreaterThan(0)
      console.log(`Mutation performance with ${size} records:`, {
        insertTime,
        updateTime,
        throughputResult,
        blockingTime,
      })
    })
  }
})
