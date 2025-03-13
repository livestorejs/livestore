/**
 * @remarks
 * Playwright does not support sending CDP (Chrome DevTools Protocol) commands to different targets other than the main thread.
 * See {@link https://github.com/microsoft/playwright/issues/22992}.
 *
 */
import fs from 'node:fs'

import MemlabApi from '@memlab/api'
import { type CDPSession, expect } from '@playwright/test'

import { perfTest } from '../fixtures/perfTest.ts'

const checkLastSnapshotChunk = (chunk: string): void => {
  const regex = /}\s*$/
  if (!regex.test(chunk)) {
    throw new Error('resolved `HeapProfiler.takeHeapSnapshot` before writing the last chunk')
  }
}

/**
 * Takes a JavaScript heap snapshot and saves it to a file in the test’s output directory.
 *
 * @remarks
 * The `HeapProfiler.takeHeapSnapshot` implicitly triggers garbage collection. We don’t need to force it before taking
 * the snapshot.
 */
const takeJsHeapSnapshot = async (cdpSession: CDPSession, filePath: string): Promise<void> => {
  const writeStream = fs.createWriteStream(filePath, { encoding: 'utf8' })

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
}

/**
 * @remarks
 * Playwright does not support sending CDP (Chrome DevTools Protocol) commands to different targets other than the main thread.
 * See {@link https://github.com/microsoft/playwright/issues/22992}.
 *
 */
perfTest.describe('Memory leak (main thread)', () => {
  perfTest('after creating and updating rows 5 times', async ({ page, context }, testInfo) => {
    perfTest.slow()
    await page.goto('./')

    const cdpSession = await context.newCDPSession(page)

    const snapshotFilePaths = {
      baseline: testInfo.outputPath('baseline.heapsnapshot'),
      target: testInfo.outputPath('target.heapsnapshot'),
      final: testInfo.outputPath('final.heapsnapshot'),
    }

    await perfTest.step('baseline', async () => {
      await page.locator('#run').waitFor()
      await takeJsHeapSnapshot(cdpSession, snapshotFilePaths.baseline)
    })

    await perfTest.step('target', async () => {
      for (let i = 0; i < 5; i++) {
        await page.locator('#add').click()
        await expect(page.locator(`tbody>tr:nth-of-type(${1000 * (i + 1)})>td:nth-of-type(1)`)).toHaveText(
          (1000 * (i + 1)).toFixed(0),
        )
        await page.locator('#update').click()
        await expect(page.locator('tbody>tr:nth-of-type(1)>td:nth-of-type(2)>a')).toContainText(' !!!'.repeat(i))
      }
      await takeJsHeapSnapshot(cdpSession, snapshotFilePaths.target)
    })

    await perfTest.step('final', async () => {
      await page.locator('#clear').click()
      await expect(page.locator('tbody>tr:nth-of-type(1000)>td:nth-of-type(1)')).not.toBeVisible()
      await takeJsHeapSnapshot(cdpSession, snapshotFilePaths.final)
    })

    const leaks = await MemlabApi.findLeaksBySnapshotFilePaths(
      snapshotFilePaths.baseline,
      snapshotFilePaths.target,
      snapshotFilePaths.final,
    )

    expect(leaks.length, 'Should not have any memory leaks').toBe(0)
  })
})
