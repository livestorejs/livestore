import { expect } from '@playwright/test'

import { perfTest } from '../fixtures/perfTest.js'

perfTest.describe('Latency', { annotation: { type: 'measurement unit', description: 'ms' } }, () => {
  perfTest.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  perfTest.afterEach(async ({ page }, testInfo) => {
    const measurement = await page.evaluate(() => {
      return new Promise<number>((resolve) => {
        new PerformanceObserver((entryList) => {
          const entries = entryList.getEntries()
          const clickEntries = entries.filter((entry) => entry.name === 'click')
          // The last click entry is the one we are interested in
          const lastClickEntry = clickEntries.at(-1)
          if (!lastClickEntry) throw new Error('No click entry found')
          resolve(lastClickEntry.duration) // Duration is provided rounded to the nearest 8 ms for privacy reasons
        }).observe({
          type: 'event',
          buffered: true,
          // A durationThreshold of 16 ms is necessary to include more interactions,
          // since the default is 104 ms. The minimum durationThreshold is 16 ms.
          // @ts-expect-error the type is wrong. `durationThreshold` is a valid property to pass to `observe`.
          durationThreshold: 16,
        })
      })
    })

    testInfo.annotations.push({ type: 'measurement', description: measurement.toString() })
  })

  perfTest.only('for creating 1,000 rows', async ({ page }, testInfo) => {
    const warmupCount = 5

    testInfo.annotations.push({ type: 'warmup runs', description: warmupCount.toString() })

    await perfTest.step('warmup', async () => {
      for (let i = 0; i < warmupCount; i++) {
        await page.locator('#create1k').click()
        await expect(page.locator('tbody>tr:nth-of-type(1)>td:nth-of-type(1)')).toHaveText((i * 1000 + 1).toFixed(0))
        await page.locator('#clear').click()
        await expect(page.locator('tbody>tr:nth-of-type(1000)>td:nth-of-type(1)')).not.toBeVisible()
      }
    })

    await perfTest.step('prepare', async () => {
      await page.requestGC()
    })

    await perfTest.step('run', async () => {
      await page.locator('#create1k').click()
      await expect(page.locator('tbody>tr:nth-of-type(1000)>td:nth-of-type(1)')).toHaveText(
        ((warmupCount + 1) * 1000).toFixed(0),
      )
    })
  })

  perfTest('for updating all 1,000 rows', async ({ page }, testInfo) => {
    const warmupCount = 5

    testInfo.annotations.push({ type: 'warmup runs', description: warmupCount.toString() })

    await perfTest.step('warmup', async () => {
      for (let i = 0; i < warmupCount; i++) {
        await page.locator('#create1k').click()
        await expect(page.locator('tbody>tr:nth-of-type(1)>td:nth-of-type(1)')).toHaveText((i * 1000 + 1).toFixed(0))
      }
    })

    await perfTest.step('prepare', async () => {
      await page.requestGC()
    })

    await perfTest.step('run', async () => {
      await page.locator('#create1k').click()
      await expect(page.locator('tbody>tr:nth-of-type(1)>td:nth-of-type(1)')).toHaveText(
        (warmupCount * 1000 + 1).toFixed(0),
      )
    })
  })

  perfTest('for updating every 10th row of 1,000 rows', async ({ page, context }, testInfo) => {
    const warmupCount = 3
    const cpuThrottlingRate = 4

    testInfo.annotations.push(
      { type: 'cpu throttling rate', description: cpuThrottlingRate.toString() },
      { type: 'warmup runs', description: warmupCount.toString() },
    )

    await perfTest.step('warmup', async () => {
      await page.locator('#create1k').click()
      await expect(page.locator('tbody>tr:nth-of-type(1000)>td:nth-of-type(1)')).toHaveText((1000).toFixed(0))
      for (let i = 0; i < warmupCount; i++) {
        await page.locator('#updateEvery10th').click()
        await expect(page.locator('tbody>tr:nth-of-type(991)>td:nth-of-type(2)>button')).toContainText(
          ' !!!'.repeat(i + 1),
        )
      }
    })

    await perfTest.step('prepare', async () => {
      await page.requestGC()
      const cdpSession = await context.newCDPSession(page)
      await cdpSession.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottlingRate })
    })

    await perfTest.step('run', async () => {
      await page.locator('#updateEvery10th').click()
      await expect(page.locator('tbody>tr:nth-of-type(991)>td:nth-of-type(2)>button')).toContainText(
        ' !!!'.repeat(3 + 1),
      )
    })
  })

  perfTest('for highlighting a selected row', async ({ page, context }, testInfo) => {
    const warmupCount = 5
    const cpuThrottlingRate = 4

    testInfo.annotations.push(
      { type: 'cpu throttling rate', description: cpuThrottlingRate.toString() },
      { type: 'warmup runs', description: warmupCount.toString() },
    )

    await perfTest.step('warmup', async () => {
      await page.locator('#create1k').click()
      await expect(page.locator('tbody>tr:nth-of-type(1000)>td:nth-of-type(1)')).toHaveText((1000).toFixed(0))
      for (let i = 0; i < warmupCount; i++) {
        await page.locator(`tbody>tr:nth-of-type(${i + 5})>td:nth-of-type(2)>button`).click()
        await expect(page.locator(`tbody>tr:nth-of-type(${i + 5})`)).toHaveCSS('background-color', 'rgb(173, 216, 230)')
      }
    })

    await perfTest.step('prepare', async () => {
      await page.requestGC()
      const cdpSession = await context.newCDPSession(page)
      await cdpSession.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottlingRate })
    })

    await perfTest.step('run', async () => {
      await page.locator('tbody>tr:nth-of-type(2)>td:nth-of-type(2)>button').click()
      await expect(page.locator('tbody>tr:nth-of-type(2)')).toHaveCSS('background-color', 'rgb(173, 216, 230)')
    })
  })

  perfTest('for removing one row', async ({ page, context }, testInfo) => {
    const rowsToSkip = 4
    const warmupCount = 5
    const cpuThrottlingRate = 2

    testInfo.annotations.push(
      { type: 'cpu throttling rate', description: cpuThrottlingRate.toString() },
      { type: 'warmup runs', description: warmupCount.toString() },
    )

    await perfTest.step('warmup', async () => {
      await page.locator('#create1k').click()
      await expect(page.locator('tbody>tr:nth-of-type(1000)>td:nth-of-type(1)')).toBeVisible()
      for (let i = 0; i < warmupCount; i++) {
        const rowToClick = warmupCount - i + rowsToSkip
        await expect(page.locator(`tbody>tr:nth-of-type(${rowToClick})>td:nth-of-type(1)`)).toHaveText(
          rowToClick.toString(),
        )
        await page.locator(`tbody>tr:nth-of-type(${rowToClick})>td:nth-of-type(3)>button>span:nth-of-type(1)`).click()
        await expect(page.locator(`tbody>tr:nth-of-type(${rowToClick})>td:nth-of-type(1)`)).toHaveText(
          `${rowsToSkip + warmupCount + 1}`,
        )
      }
      await expect(page.locator(`tbody>tr:nth-of-type(${rowsToSkip + 1})>td:nth-of-type(1)`)).toHaveText(
        `${rowsToSkip + warmupCount + 1}`,
      )
      await expect(page.locator(`tbody>tr:nth-of-type(${rowsToSkip})>td:nth-of-type(1)`)).toHaveText(`${rowsToSkip}`)

      // Click on a row the second time
      await expect(page.locator(`tbody>tr:nth-of-type(${rowsToSkip + 2})>td:nth-of-type(1)`)).toHaveText(
        `${rowsToSkip + warmupCount + 2}`,
      )
      await page.locator(`tbody>tr:nth-of-type(${rowsToSkip + 2})>td:nth-of-type(3)>button>span:nth-of-type(1)`).click()
      await expect(page.locator(`tbody>tr:nth-of-type(${rowsToSkip + 2})>td:nth-of-type(1)`)).toHaveText(
        `${rowsToSkip + warmupCount + 3}`,
      )
    })

    await perfTest.step('prepare', async () => {
      await page.requestGC()
      const cdpSession = await context.newCDPSession(page)
      await cdpSession.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottlingRate })
    })

    await perfTest.step('run', async () => {
      await page.locator(`tbody>tr:nth-of-type(${rowsToSkip})>td:nth-of-type(3)>button>span:nth-of-type(1)`).click()
      await expect(page.locator(`tbody>tr:nth-of-type(${rowsToSkip})>td:nth-of-type(1)`)).toHaveText(
        `${rowsToSkip + warmupCount + 1}`,
      )
    })
  })

  perfTest('for creating 10,000 rows', async ({ page }, testInfo) => {
    const warmupCount = 5

    testInfo.annotations.push({ type: 'warmup runs', description: warmupCount.toString() })

    await perfTest.step('warmup', async () => {
      for (let i = 0; i < warmupCount; i++) {
        await page.locator('#create1k').click()
        await expect(page.locator('tbody>tr:nth-of-type(1)>td:nth-of-type(1)')).toHaveText((i * 1000 + 1).toFixed(0))
        await page.locator('#clear').click()
        await expect(page.locator('tbody>tr:nth-of-type(1000)>td:nth-of-type(1)')).not.toBeVisible()
      }
    })

    await perfTest.step('prepare', async () => {
      await page.requestGC()
    })

    await perfTest.step('run', async () => {
      await page.locator('#create10k').click()
      await expect(page.locator('tbody>tr:nth-of-type(10000)>td:nth-of-type(2)>button')).toBeVisible()
    })
  })

  perfTest('for appending 1,000 to a table with 1,000 rows', async ({ page }, testInfo) => {
    const warmupCount = 5

    testInfo.annotations.push({ type: 'warmup runs', description: warmupCount.toString() })

    await perfTest.step('warmup', async () => {
      for (let i = 0; i < warmupCount; i++) {
        await page.locator('#create1k').click()
        await expect(page.locator('tbody>tr:nth-of-type(1)>td:nth-of-type(1)')).toHaveText((i * 1000 + 1).toFixed(0))
        await page.locator('#clear').click()
        await expect(page.locator('tbody>tr:nth-of-type(1000)>td:nth-of-type(1)')).not.toBeVisible()
      }
      await page.locator('#create1k').click()
      await expect(page.locator('tbody>tr:nth-of-type(1000)>td:nth-of-type(1)')).toBeVisible()
    })

    await perfTest.step('prepare', async () => {
      await page.requestGC()
    })

    await perfTest.step('run', async () => {
      await page.locator('#append1k').click()
      await expect(page.locator('tbody>tr:nth-of-type(2000)>td:nth-of-type(1)')).toBeVisible()
    })
  })

  perfTest('for clearing a table with 1,000 rows', async ({ page, context }, testInfo) => {
    const warmupCount = 5
    const cpuThrottlingRate = 4

    testInfo.annotations.push(
      { type: 'cpu throttling rate', description: cpuThrottlingRate.toString() },
      { type: 'warmup runs', description: warmupCount.toString() },
    )

    await perfTest.step('warmup', async () => {
      for (let i = 0; i < warmupCount; i++) {
        await page.locator('#create1k').click()
        await expect(page.locator('tbody>tr:nth-of-type(1)>td:nth-of-type(1)')).toHaveText((i * 1000 + 1).toFixed(0))
        await page.locator('#clear').click()
        await expect(page.locator('tbody>tr:nth-of-type(1000)>td:nth-of-type(1)')).not.toBeVisible()
      }
      await page.locator('#create1k').click()
      await expect(page.locator('tbody>tr:nth-of-type(1)>td:nth-of-type(1)')).toHaveText(`${warmupCount * 1000 + 1}`)
    })

    await perfTest.step('prepare', async () => {
      await page.requestGC()
      const cdpSession = await context.newCDPSession(page)
      await cdpSession.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottlingRate })
    })

    await perfTest.step('run', async () => {
      await page.locator('#clear').click()
      await expect(page.locator('tbody>tr:nth-of-type(1000)>td:nth-of-type(1)')).not.toBeVisible()
    })
  })
})
