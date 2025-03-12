import { expect } from '@playwright/test'
import { DatabaseSize, generateDatabase } from '../fixtures/dataGenerator.ts'
import { perfTest } from '../fixtures/perfTest.ts'

perfTest.describe('Query performance', () => {
  perfTest.beforeEach(async ({ page }) => {
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
    perfTest(`with ${size} records`, async ({ page }, testInfo) => {
      const todos = generateDatabase(size)

      await page.evaluate((data) => {
        globalThis.prepareStore(data)
      }, todos)

      const simpleQueryTime = await page.evaluate(() => {
        const startTime = performance.now()
        globalThis.runSimpleQuery()
        return performance.measure('simple-query', { start: startTime }).duration
      })

      // metrics.queryLatency(simpleQueryTime, {
      //   database_size: size.toString(),
      //   query_type: 'simple',
      // })

      const filteredQueryTime = await page.evaluate(() => {
        const queryStartTime = performance.now()
        globalThis.runFilteredQuery()
        return performance.measure('filtered-query', { start: queryStartTime }).duration
      })

      // metrics.queryLatency(filteredQueryTime, {
      //   database_size: size.toString(),
      //   query_type: 'filtered',
      // })

      const complexQueryTime = await page.evaluate(() => {
        const queryStartTime = performance.now()
        globalThis.runComplexQuery()
        return performance.measure('complex-query', { start: queryStartTime }).duration
      })

      // metrics.queryLatency(complexQueryTime, {
      //   database_size: size.toString(),
      //   query_type: 'complex',
      // })

      const throughputResult = await page.evaluate(() => {
        return globalThis.measureQueryThroughput(1000)
      })

      // metrics.queryThroughput(throughputResult.queriesPerSecond, {
      //   database_size: size.toString(),
      // })

      // Basic assertions to ensure test is working
      expect(simpleQueryTime).toBeGreaterThan(0)
      expect(filteredQueryTime).toBeGreaterThan(0)
      expect(complexQueryTime).toBeGreaterThan(0)
      console.log(`Query performance with ${size} records:`, {
        simpleQueryTime,
        filteredQueryTime,
        complexQueryTime,
        throughputResult,
      })

      const jsonBuffer = new TextEncoder().encode(
        JSON.stringify({ simpleQueryTime, filteredQueryTime, throughputResult }),
      )

      await testInfo.attach('result', {
        contentType: 'application/json',
        body: Buffer.from(jsonBuffer),
      })
    })
  }
})
