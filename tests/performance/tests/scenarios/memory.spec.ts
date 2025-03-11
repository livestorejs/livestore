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
        const todos = generateDatabase(size)

        const baselineMemory = await page.evaluate(() => {
          // @ts-expect-error `Performance.memory` is deprecated, but we still use it until `Performance.measureUserAgentSpecificMemory()` becomes available.
          const memory: { usedJSHeapSize: number } = performance.memory
          return memory.usedJSHeapSize / (1024 * 1024)
        })

        await page.evaluate((data) => {
          globalThis.prepareStore(data)
        }, todos)

        const afterInitMemory = await page.evaluate(() => {
          // @ts-expect-error `Performance.memory` is deprecated, but we still use it until `Performance.measureUserAgentSpecificMemory()` becomes available.
          const memory: { usedJSHeapSize: number } = performance.memory
          return memory.usedJSHeapSize / (1024 * 1024)
        })

        const memoryProfile = await page.evaluate(() => {
          return globalThis.runMemoryProfileTest()
        })

        // TODO: Should we force garbage collection before measuring final memory?

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
