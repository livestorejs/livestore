import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import {
  repeatSuite as baseRepeatSuite,
  shouldRecordPerfProfile as baseShouldRecordPerfProfile,
} from '../../perf/tests/utils.ts'

export const repeatSuite = baseRepeatSuite
export const shouldRecordPerfProfile = baseShouldRecordPerfProfile

const SELECTORS = {
  status: '[data-testid="stream-status"]',
  todoMeta: '[data-testid="todo-meta"]',
  totalInput: '[data-testid="config-total"]',
  rateInput: '[data-testid="config-rate"]',
  startStream: '[data-testid="start-stream"]',
  stopStream: '[data-testid="stop-stream"]',
  startGenerate: '[data-testid="start-generate"]',
  stopGenerate: '[data-testid="stop-generate"]',
  resetHarness: '[data-testid="reset-harness"]',
}

const SEED_BUTTON_IDS = new Map<number, string>([
  [1_000, 'seed-1k'],
  [10_000, 'seed-10k'],
  [100_000, 'seed-100k'],
])

const getNumericAttribute = (element: Element | null, attribute: string): number => {
  if (!element) return 0
  const value = element.getAttribute(attribute)
  if (!value) return 0
  const parsed = Number(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

type StatusSnapshot = {
  streamingStatus: string
  generatorStatus: string
  queueLength: number
  generatedCount: number
  streamedCount: number
  seededCount: number
  runId: string
  rate: number
}

type TodoSnapshot = {
  total: number
  completed: number
  active: number
}

const getStatusSnapshot = async (page: Page): Promise<StatusSnapshot> => {
  return await page.evaluate((selector: string) => {
    const node = document.querySelector<HTMLElement>(selector)
    if (!node) {
      return {
        streamingStatus: 'idle',
        generatorStatus: 'idle',
        queueLength: 0,
        generatedCount: 0,
        streamedCount: 0,
        seededCount: 0,
        runId: '',
        rate: 0,
      }
    }

    const read = (attr: string) => node.getAttribute(attr) ?? ''
    const readNumber = (attr: string) => {
      const raw = node.getAttribute(attr)
      if (!raw) return 0
      const parsed = Number(raw)
      return Number.isNaN(parsed) ? 0 : parsed
    }

    return {
      streamingStatus: read('data-streaming-status') || 'idle',
      generatorStatus: read('data-generator-status') || 'idle',
      queueLength: readNumber('data-queue-length'),
      generatedCount: readNumber('data-generated-count'),
      streamedCount: readNumber('data-streamed-count'),
      seededCount: readNumber('data-seeded-count'),
      runId: read('data-run-id'),
      rate: readNumber('data-rate'),
    }
  }, SELECTORS.status)
}

const getTodoSnapshot = async (page: Page): Promise<TodoSnapshot> => {
  return await page.evaluate((selector: string) => {
    const node = document.querySelector<HTMLElement>(selector)
    if (!node) {
      return { total: 0, completed: 0, active: 0 }
    }
    const readNumber = (attr: string) => {
      const raw = node.getAttribute(attr)
      if (!raw) return 0
      const parsed = Number(raw)
      return Number.isNaN(parsed) ? 0 : parsed
    }

    return {
      total: readNumber('data-total'),
      completed: readNumber('data-completed'),
      active: readNumber('data-active'),
    }
  }, SELECTORS.todoMeta)
}

const waitForStreamingStatus = async (page: Page, status: string) => {
  await page.waitForFunction(
    ({ selector, expected }) => {
      const node = document.querySelector<HTMLElement>(selector)
      return node?.getAttribute('data-streaming-status') === expected
    },
    { selector: SELECTORS.status, expected: status },
  )
}

const waitForGeneratorStatus = async (page: Page, status: string) => {
  await page.waitForFunction(
    ({ selector, expected }) => {
      const node = document.querySelector<HTMLElement>(selector)
      return node?.getAttribute('data-generator-status') === expected
    },
    { selector: SELECTORS.status, expected: status },
  )
}

const waitForQueueLength = async (page: Page, length: number) => {
  await page.waitForFunction(
    ({ selector, expected }) => {
      const node = document.querySelector<HTMLElement>(selector)
      if (!node) return false
      const value = Number(node.getAttribute('data-queue-length') ?? '0')
      return value === expected
    },
    { selector: SELECTORS.status, expected: length },
  )
}

export const resetHarness = async (page: Page) => {
  await page.goto('/')
  await page.locator(SELECTORS.status).waitFor({ state: 'visible' })

  let snapshot = await getStatusSnapshot(page)

  if (snapshot.generatorStatus === 'running') {
    const stopGenerator = page.locator(SELECTORS.stopGenerate)
    if (await stopGenerator.isVisible() && (await stopGenerator.isEnabled())) {
      await stopGenerator.click()
    }
    await waitForGeneratorStatus(page, 'stopped')
    snapshot = await getStatusSnapshot(page)
  }

  if (snapshot.streamingStatus === 'running') {
    const stopStream = page.locator(SELECTORS.stopStream)
    if (await stopStream.isVisible() && (await stopStream.isEnabled())) {
      await stopStream.click()
    }
  await page.waitForFunction(
    ({ selector }) => {
      const node = document.querySelector<HTMLElement>(selector)
      return node?.getAttribute('data-streaming-status') !== 'running'
    },
    { selector: SELECTORS.status },
  )
  }

  const resetButton = page.locator(SELECTORS.resetHarness)
  if (await resetButton.isVisible() && (await resetButton.isEnabled())) {
    await resetButton.click()
  }

  await waitForStreamingStatus(page, 'idle')
  await waitForGeneratorStatus(page, 'idle')
  await waitForQueueLength(page, 0)
  await page.waitForFunction(
    ({ selector }) => {
      const node = document.querySelector<HTMLElement>(selector)
      return node?.getAttribute('data-total') === '0'
    },
    { selector: SELECTORS.todoMeta },
  )
}

export const configureGenerator = async (
  page: Page,
  config: {
    total?: number
    eventsPerSecond?: number
  },
) => {
  if (config.total !== undefined) {
    await page.locator(SELECTORS.totalInput).fill(Math.max(0, Math.floor(config.total)).toString())
  }
  if (config.eventsPerSecond !== undefined) {
    await page
      .locator(SELECTORS.rateInput)
      .fill(Math.max(1, Math.floor(config.eventsPerSecond)).toString())
  }
}

export const seedTodos = async (page: Page, count: number) => {
  const buttonId = SEED_BUTTON_IDS.get(count)
  if (!buttonId) {
    throw new Error(`Unsupported seed count: ${count}`)
  }

  const before = await getStatusSnapshot(page)
  const button = page.locator(`[data-testid="${buttonId}"]`)
  await expect(button).toBeEnabled()
  await button.click()

  const expectedQueue = before.queueLength + count
  const expectedGenerated = before.generatedCount + count
  const expectedSeeded = before.seededCount + count

  await page.waitForFunction(
    ({ selector, queueLen, generated, seeded }) => {
      const node = document.querySelector<HTMLElement>(selector)
      if (!node) return false
      const queue = Number(node.getAttribute('data-queue-length') ?? '0')
      const gen = Number(node.getAttribute('data-generated-count') ?? '0')
      const seed = Number(node.getAttribute('data-seeded-count') ?? '0')
      return queue === queueLen && gen === generated && seed === seeded
    },
    {
      selector: SELECTORS.status,
      queueLen: expectedQueue,
      generated: expectedGenerated,
      seeded: expectedSeeded,
    },
  )
}

export const startStreaming = async (page: Page) => {
  const startButton = page.locator(SELECTORS.startStream)
  await expect(startButton).toBeEnabled()
  await page.evaluate(() => {
    ;(window as any).__streamPerfStart = performance.now()
  })
  await startButton.click()
  await waitForStreamingStatus(page, 'running')
}

export const stopStreaming = async (page: Page) => {
  const stopButton = page.locator(SELECTORS.stopStream)
  if (!(await stopButton.isEnabled())) return
  await stopButton.click()
  await page.waitForFunction(
    ({ selector }) => {
      const node = document.querySelector<HTMLElement>(selector)
      const status = node?.getAttribute('data-streaming-status')
      return status !== 'running'
    },
    { selector: SELECTORS.status },
  )
}

export const startGenerator = async (page: Page) => {
  const startButton = page.locator(SELECTORS.startGenerate)
  await expect(startButton).toBeEnabled()
  await startButton.click()
  await waitForGeneratorStatus(page, 'running')
}

export const stopGenerator = async (page: Page) => {
  const stopButton = page.locator(SELECTORS.stopGenerate)
  if (!(await stopButton.isEnabled())) return
  await stopButton.click()
  await page.waitForFunction(
    ({ selector }) => {
      const node = document.querySelector<HTMLElement>(selector)
      const status = node?.getAttribute('data-generator-status')
      return status !== 'running'
    },
    { selector: SELECTORS.status },
  )
}

export const waitForStreamingCompletion = async (page: Page): Promise<StatusSnapshot> => {
  await waitForStreamingStatus(page, 'complete')
  return await getStatusSnapshot(page)
}

export const collectStreamingMetrics = async (page: Page) => {
  const duration = await page.evaluate(() => {
    const start = (window as any).__streamPerfStart ?? performance.now()
    delete (window as any).__streamPerfStart
    return performance.now() - start
  })

  const status = await getStatusSnapshot(page)
  const todos = await getTodoSnapshot(page)

  return {
    duration,
    status,
    todos,
  }
}
