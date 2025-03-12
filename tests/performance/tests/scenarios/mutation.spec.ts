import { test, expect } from '@playwright/test'
import { DatabaseSize, generateDatabase } from '../fixtures/dataGenerator.ts'

test.describe('Mutation Performance', () => {
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

      const insertTime = await page.evaluate(() => {
        performance.mark('insert:start')
        globalThis.runSingleInsert({
          id: 'new-todo-' + Date.now(),
          text: 'New todo item',
          completed: false,
          deleted: null,
        })
        performance.mark('insert:end')
        return performance.measure('insert', 'insert:start', 'insert:end').duration
      })

      // metrics.mutationLatency(insertTime, {
      //   'database_size': size.toString(),
      //   'mutation_type': 'insert'
      // })

      const randomTodoIds = todos
        .sort(() => Math.random())
        .slice(0, 50)
        .map((todo) => todo.id)

      const batchUpdateTime = await page.evaluate((todoIds) => {
        performance.mark('update:start')
        globalThis.runBatchUpdate(todoIds)
        performance.mark('update:end')
        return performance.measure('update', 'update:start', 'update:end').duration
      }, randomTodoIds)

      // metrics.mutationLatency(updateTime, {
      //   'database_size': size.toString(),
      //   'mutation_type': 'batch_update'
      // })

      const throughputResult = await page.evaluate(() => {
        return globalThis.measureMutationThroughput(1000) // 1 second test
      })

      // metrics.mutationThroughput(throughputResult.mutationsPerSecond, {
      //   'database_size': size.toString()
      // })

      expect(insertTime).toBeGreaterThan(0)
      console.log(`Mutation performance with ${size} records:`, {
        insertTime,
        batchUpdateTime,
        throughputResult,
      })
    })
  }
})
