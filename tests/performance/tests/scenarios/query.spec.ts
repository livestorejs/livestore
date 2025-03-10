import { expect, test } from '@playwright/test'
import { DatabaseSize, generateDatabase } from '../fixtures/dataGenerator.ts'

test.describe('Query Performance Tests', () => {
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
    test(`Query performance with ${size} records`, async ({ page }, testInfo) => {
      console.group('Query performance with ${size} records')
      const todos = generateDatabase(size)

      await page.evaluate((data) => {
        globalThis.prepareStore(data)
      }, todos)

      // Measure simple query performance
      const simpleQueryTime = await page.evaluate(() => {
        performance.mark('simple-query-start')
        globalThis.runSimpleQuery()
        performance.mark('simple-query-end')
        return performance.measure('simple-query', 'simple-query-start', 'simple-query-end').duration
      })

      // Record metrics
      // metrics.queryLatency.record(simpleQueryTime, {
      //   database_size: size.toString(),
      //   query_type: 'simple',
      // })
      // Log to console the simple query time and its metadata

      // Measure filtered query performance
      const filteredQueryTime = await page.evaluate(() => {
        performance.mark('filtered-query-start')
        globalThis.runFilteredQuery()
        performance.mark('filtered-query-end')
        return performance.measure('filtered-query', 'filtered-query-start', 'filtered-query-end').duration
      })

      // Record metrics
      // metrics.queryLatency.record(filteredQueryTime, {
      //   database_size: size.toString(),
      //   query_type: 'filtered',
      // })

      // Measure query throughput
      // const throughputResult = await page.evaluate(() => {
      //   return window.measureQueryThroughput(1000) // 1 second test
      // })
      //
      // metrics.queryThroughput.add(throughputResult.queriesPerSecond, {
      //   database_size: size.toString(),
      // })

      // Check main thread blocking
      // const blockingTime = await page.evaluate(() => {
      //   return globalThis.measureMainThreadBlocking(() => {
      //     globalThis.runComplexQuery()
      //   })
      // })

      // metrics.mainThreadBlocking.record(blockingTime, {
      //   database_size: size.toString(),
      //   operation_type: 'complex_query',
      // })

      // Basic assertions to ensure test is working
      expect(simpleQueryTime).toBeGreaterThan(0)
      console.log(`Query performance with ${size} records:`, { simpleQueryTime, filteredQueryTime })

      const jsonBuffer = new TextEncoder().encode(JSON.stringify({ simpleQueryTime, filteredQueryTime }))

      await testInfo.attach('result', {
        contentType: 'application/json',
        body: Buffer.from(jsonBuffer)
      })
    })
  }
})
