import { fileURLToPath } from 'node:url'
import { expect, type CDPSession, type Page } from '@playwright/test'
import { test } from '../fixtures.ts'

const SNAPSHOT_EXPECTED_EVENTS = 10_000
const SNAPSHOT_STATE_PATH = fileURLToPath(new URL('../snapshots/state-10_000.db', import.meta.url))
const SNAPSHOT_EVENTLOG_PATH = fileURLToPath(new URL('../snapshots/eventlog-10_000.db', import.meta.url))
const BYTES_IN_MB = 1024 * 1024
const WORKER_URL_FRAGMENT = 'livestore.worker'

const loadSnapshots = async (page: Page) => {
  await page.setInputFiles('[data-testid="snapshot-state-input"]', SNAPSHOT_STATE_PATH)
  await page.setInputFiles('[data-testid="snapshot-eventlog-input"]', SNAPSHOT_EVENTLOG_PATH)
  await page.getByTestId('load-snapshots').click()
  await page.waitForFunction(
    () => document.body.innerText.includes('LiveStore Shutdown due to devtools import'),
    undefined,
    { timeout: 60_000 },
  )
}

const enableHeapTools = async (session: CDPSession) => {
  await session.send('Runtime.enable')
  await session.send('HeapProfiler.enable')
}

const sampleHeap = async (session: CDPSession) => {
  await enableHeapTools(session)
  await session.send('HeapProfiler.collectGarbage')
  return session.send('Runtime.getHeapUsage')
}

type UserAgentSpecificMemoryResult = {
  breakdown: Array<{
    bytes: number
    attribution: Array<{
      scope: string
      url?: string
    }>
  }>
}

type WorkerHeapSample = {
  bytes: number | null
  diag: {
    crossOriginIsolated: boolean
    hasMeasure: boolean
    errorName?: string
    errorMessage?: string
  }
}

const readWorkerHeapUsage = async (page: Page): Promise<WorkerHeapSample> => {
  return page.evaluate(async (workerFragment) => {
    const perf = performance as Performance & {
      measureUserAgentSpecificMemory?: () => Promise<UserAgentSpecificMemoryResult>
    }
    const crossOriginIsolated = window.crossOriginIsolated
    const hasMeasure = typeof perf.measureUserAgentSpecificMemory === 'function'

    if (!perf.measureUserAgentSpecificMemory) {
      return {
        bytes: null,
        diag: { crossOriginIsolated, hasMeasure },
      }
    }

    try {
      const measurement = await perf.measureUserAgentSpecificMemory()
      const bytes = measurement.breakdown
        .filter((entry) =>
          entry.attribution.some(
            (item) => item.scope === 'DedicatedWorkerGlobalScope' && item.url?.includes(workerFragment),
          ),
        )
        .reduce((total, entry) => total + entry.bytes, 0)

      return {
        bytes,
        diag: { crossOriginIsolated, hasMeasure },
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'SecurityError') {
        return {
          bytes: null,
          diag: { crossOriginIsolated, hasMeasure, errorName: error.name, errorMessage: error.message },
        }
      }
      throw error
    }
  }, WORKER_URL_FRAGMENT)
}

const measureHeapDelta = async ({
  label,
  page,
  mainSession,
  action,
}: {
  label: string
  page: Page
  mainSession: CDPSession
  action: () => Promise<void>
}) => {
  await page.requestGC()
  const mainBefore = await sampleHeap(mainSession)
  const workerBefore = await readWorkerHeapUsage(page)

  await action()

  await page.requestGC()
  const mainAfter = await sampleHeap(mainSession)
  const workerAfter = await readWorkerHeapUsage(page)

  const mainDelta = (mainAfter.usedSize - mainBefore.usedSize) / BYTES_IN_MB
  if (workerBefore.bytes === null || workerAfter.bytes === null) {
    console.warn('[HEAP] Worker measurement unavailable', {
      before: workerBefore.diag,
      after: workerAfter.diag,
    })
  }
  const workerDelta =
    workerBefore.bytes !== null && workerAfter.bytes !== null
      ? ((workerAfter.bytes - workerBefore.bytes) / BYTES_IN_MB).toFixed(2)
      : 'n/a'

  console.log(`[MEMORY][${label}] main Δ ${mainDelta.toFixed(2)} MB · worker Δ ${workerDelta} MB`)
}

test.describe('Streaming latency', () => {
  test('stream 500 events', async ({ page, cpuProfiler }, _testInfo) => {
    await test.step('prepare', async () => {
      await page.goto('/')
      await page.getByTestId('reset-harness').click()
      await expect(page.getByTestId('app')).toBeVisible()
      await page.getByTestId('seed-500').click()
      await expect(page.getByTestId('syncstate')).toHaveText('Synced', { timeout: 30000 })
      await page.requestGC()
    })

    await test.step('warmup', async () => {
      await cpuProfiler.start('cold')
      const startTime = Date.now()
      await page.getByTestId('toggle-events').click()
      await expect(page.getByTestId('events-streamed')).toHaveText('500', { timeout: 60000 })
      const duration = Date.now() - startTime
      await cpuProfiler.stop('streaming')
      console.log(`[COLD]: Streamed 500 events in ${duration}ms`)
    })

    await test.step('run', async () => {
      await page.reload()
      await cpuProfiler.start('warm')
      const startTime = Date.now()
      await page.getByTestId('toggle-events').click()
      await expect(page.getByTestId('events-streamed')).toHaveText('500', { timeout: 60000 })
      const duration = Date.now() - startTime
      await cpuProfiler.stop('streaming')
      console.log(`[WARM]: Streamed 500 events in ${duration}ms`)
    })
  })

  test('stream snapshots (10k events)', async ({ page, context, cpuProfiler }, _testInfo) => {
    await test.step('prepare', async () => {
      await page.goto('/')
      await page.getByTestId('reset-harness').click()
      await expect(page.getByTestId('app')).toBeVisible()

      await loadSnapshots(page)
      await page.reload()
      await page.requestGC()
    })

    await test.step('run', async () => {
      await cpuProfiler.start('snapshot')
      const mainSession = await context.newCDPSession(page)
      try {
        const startTime = Date.now()
        await measureHeapDelta({
          label: 'snapshot-stream',
          page,
          mainSession,
          action: async () => {
            await page.getByTestId('toggle-events').click()
            await expect(page.getByTestId('events-streamed')).toHaveText(String(SNAPSHOT_EXPECTED_EVENTS), {
              timeout: 60000,
            })
          },
        })
        const duration = Date.now() - startTime
        console.log(`[DURATION]: Streamed ${SNAPSHOT_EXPECTED_EVENTS} events in ${duration}ms`)
      } finally {
        await mainSession.detach()
        await cpuProfiler.stop('snapshot')
      }
    })
  })
})
