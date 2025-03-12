import { expect, type Page, type TestInfo } from '@playwright/test'
import { DatabaseSize, generateDatabase } from '../fixtures/dataGenerator'
import { perfTest } from '../fixtures/perfTest.ts'
import fs from 'node:fs'
import MemlabApi from '@memlab/api'

const checkLastSnapshotChunk = (chunk: string): void => {
  const regex = /}\s*$/
  if (!regex.test(chunk)) {
    throw new Error('resolved `HeapProfiler.takeHeapSnapshot` before writing the last chunk')
  }
}

const getPerformanceMetric = async (page: Page, metricName: string): Promise<number> => {
  const cdpSession = await page.context().newCDPSession(page)
  await cdpSession.send('Performance.enable')
  const { metrics } = await cdpSession.send('Performance.getMetrics')
  const metric = metrics.find((m) => m.name === metricName)
  if (!metric) {
    throw new Error(`Metric ${metricName} not found`)
  }
  return metric.value
}

/**
 * Takes a JavaScript heap snapshot and saves it to a file in the test’s output directory.
 *
 * @remarks This implicitly triggers garbage collection.
 *
 * @returns The path to the snapshot file.
 */
const takeJSHeapSnapshot = async (
  page: Page,
  tag: 'baseline' | 'target' | 'final',
  testInfo: TestInfo,
): Promise<string> => {
  const cdpSession = await page.context().newCDPSession(page)

  const snapshotFilePath = testInfo.outputPath(`${tag}.heapsnapshot`)
  const writeStream = fs.createWriteStream(snapshotFilePath, { encoding: 'utf8' })

  let lastChunk = ''
  const handleSnapshotChunk = ({ chunk }: { chunk: string }) => {
    writeStream.write(chunk)
    lastChunk = chunk
  }

  cdpSession.on('HeapProfiler.addHeapSnapshotChunk', handleSnapshotChunk)

  // start taking heap snapshot
  await cdpSession.send('HeapProfiler.takeHeapSnapshot', { captureNumericValue: true })

  checkLastSnapshotChunk(lastChunk)
  cdpSession.off('HeapProfiler.addHeapSnapshotChunk', handleSnapshotChunk)
  writeStream.end()
  return snapshotFilePath
}

perfTest.describe.only('Memory', () => {
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

      const baselineSnapshotPath = await takeJSHeapSnapshot(page, 'baseline', testInfo)
      const baselineJsHeapSize = await getPerformanceMetric(page, 'JSHeapUsedSize')
      console.log('Baseline JS heap size:', baselineJsHeapSize)

      await page.evaluate((data) => {
        globalThis.prepareStore(data)
      }, todos)

      const targetSnapshotPath = await takeJSHeapSnapshot(page, 'target', testInfo)
      const targetJsHeapSize = await getPerformanceMetric(page, 'JSHeapUsedSize')
      console.log('Target JS heap size:', targetJsHeapSize)

      const finalSnapshotPath = await takeJSHeapSnapshot(page, 'final', testInfo)
      const finalJsHeapSize = await getPerformanceMetric(page, 'JSHeapUsedSize')
      console.log('Final JS heap size:', finalJsHeapSize)

      const leaks = await MemlabApi.findLeaksBySnapshotFilePaths(
        baselineSnapshotPath,
        targetSnapshotPath,
        finalSnapshotPath,
        { consoleMode: MemlabApi.ConsoleMode.SILENT },
      )

      expect(leaks.length, 'Should not have any memory leaks').toBe(0)
    })
  }
})
