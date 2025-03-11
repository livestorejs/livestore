import { test } from '@playwright/test'
import { DatabaseSize, generateDatabase } from '../fixtures/dataGenerator'

export const runMemoryPerformanceTests = () => {
  test.describe('Memory Consumption Tests', () => {
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
      test(`Memory usage patterns with ${size} records`, async ({ page }) => {

        // Generate test data
        const todos = generateDatabase(size)

        // Measure baseline memory
        const baselineMemory = await page.evaluate(() => {
          const memory = (performance as any).memory
          return memory ? memory.usedJSHeapSize / (1024 * 1024) : null
        })

        // Initialize database
        await page.evaluate((data) => {
          window.prepareStore(data)
        }, todos)

        // Measure memory after initialization
        const afterInitMemory = await page.evaluate(() => {
          const memory = (performance as any).memory
          return memory ? memory.usedJSHeapSize / (1024 * 1024) : null
        })

        // Run a series of operations and measure memory at each step
        const memoryProfile = await page.evaluate(() => {
          return window.runMemoryProfileTest()
        })

        // Force garbage collection if possible and measure final memory
        await page.evaluate(() => {
          if (window.gc) {
            window.gc()
          }
        })

        const finalMemory = await page.evaluate(() => {
          const memory = (performance as any).memory
          return memory ? memory.usedJSHeapSize / (1024 * 1024) : null
        })

        if (baselineMemory && afterInitMemory && finalMemory) {
          const memoryIncrease = afterInitMemory - baselineMemory
          console.log(`Memory increase after loading ${size} records: ${memoryIncrease.toFixed(2)} MB`)
          console.log(`Memory profile during operations:`, memoryProfile)
          console.log(`Final memory usage: ${finalMemory.toFixed(2)} MB`)
        } else {
          console.log(`Memory metrics not available in this browser`)
        }
      })
    }
  })
}
