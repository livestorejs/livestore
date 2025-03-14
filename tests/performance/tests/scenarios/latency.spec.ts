import { expect } from '@playwright/test'

import { perfTest } from '../fixtures/perfTest.ts'

perfTest.describe('Latency', { annotation: { type: 'measurement unit', description: 'ms' } }, () => {
  perfTest.beforeEach(async ({ page }) => {
    await page.goto('./')
  })

  perfTest('for creating 1,000 rows', async ({ page }, testInfo) => {
    const warmupCount = 5
    let measurement: number

    await perfTest.step('warmup', async () => {
      for (let i = 0; i < warmupCount; i++) {
        await page.locator('#run').click()
        await expect(page.locator('tbody>tr:nth-of-type(1)>td:nth-of-type(1)')).toHaveText((i * 1000 + 1).toFixed(0))
        await page.locator('#clear').click()
        await expect(page.locator('tbody>tr:nth-of-type(1000)>td:nth-of-type(1)')).not.toBeVisible()
      }
    })

    await perfTest.step('prepare', async () => {
      await page.requestGC()
    })

    await perfTest.step('run', async () => {
      await page.locator('#run').click()
      await expect(page.locator('tbody>tr:nth-of-type(1000)>td:nth-of-type(1)')).toHaveText(
        ((warmupCount + 1) * 1000).toFixed(0),
      )
      measurement = await page.evaluate(() => {
        return performance.measure('run', 'run:start', 'run:end').duration
      })
    })

    await perfTest.step('annotate', async () => {
      testInfo.annotations.push(
        { type: 'warmup runs', description: warmupCount.toString() },
        { type: 'measurement', description: measurement.toString() },
      )
    })
  })

  perfTest('for updating all 1,000 rows', async ({ page }, testInfo) => {
    const warmupCount = 5
    let measurement: number

    await perfTest.step('warmup', async () => {
      for (let i = 0; i < warmupCount; i++) {
        await page.locator('#run').click()
        await expect(page.locator('tbody>tr:nth-of-type(1)>td:nth-of-type(1)')).toHaveText((i * 1000 + 1).toFixed(0))
      }
    })

    await perfTest.step('prepare', async () => {
      await page.requestGC()
    })

    await perfTest.step('run', async () => {
      await page.locator('#run').click()
      await expect(page.locator('tbody>tr:nth-of-type(1)>td:nth-of-type(1)')).toHaveText(
        (warmupCount * 1000 + 1).toFixed(0),
      )
      measurement = await page.evaluate(() => {
        return performance.measure('run', 'run:start', 'run:end').duration
      })
    })

    await perfTest.step('annotate', async () => {
      testInfo.annotations.push(
        { type: 'warmup runs', description: warmupCount.toString() },
        { type: 'measurement', description: measurement.toString() },
      )
    })
  })

  perfTest('for updating every 10th row for 1,000 row', async ({ page, context }, testInfo) => {
    const warmupCount = 3
    const cpuThrottlingRate = 4
    let measurement: number

    await perfTest.step('warmup', async () => {
      await page.locator('#run').click()
      await expect(page.locator('tbody>tr:nth-of-type(1000)>td:nth-of-type(1)')).toHaveText((1000).toFixed(0))
      for (let i = 0; i < warmupCount; i++) {
        await page.locator('#update').click()
        await expect(page.locator('tbody>tr:nth-of-type(991)>td:nth-of-type(2)>a')).toContainText(' !!!'.repeat(i + 1))
      }
    })

    await perfTest.step('prepare', async () => {
      await page.requestGC()
      const cdpSession = await context.newCDPSession(page)
      await cdpSession.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottlingRate })
    })

    await perfTest.step('run', async () => {
      await page.locator('#update').click()
      await expect(page.locator('tbody>tr:nth-of-type(991)>td:nth-of-type(2)>a')).toContainText(' !!!'.repeat(3 + 1))
      measurement = await page.evaluate(() => {
        return performance.measure('update', 'update:start', 'update:end').duration
      })
    })

    await perfTest.step('annotate', async () => {
      testInfo.annotations.push(
        { type: 'cpu throttling rate', description: cpuThrottlingRate.toString() },
        { type: 'warmup runs', description: warmupCount.toString() },
        { type: 'measurement', description: measurement.toString() },
      )
    })
  })

  perfTest('for highlighting a selected row', async ({ page, context }, testInfo) => {
    const warmupCount = 5
    const cpuThrottlingRate = 4
    let measurement: number

    await perfTest.step('warmup', async () => {
      await page.locator('#run').click()
      await expect(page.locator('tbody>tr:nth-of-type(1000)>td:nth-of-type(1)')).toHaveText((1000).toFixed(0))
      for (let i = 0; i < warmupCount; i++) {
        await page.locator(`tbody>tr:nth-of-type(${i + 5})>td:nth-of-type(2)>a`).click()
        await expect(page.locator(`tbody>tr:nth-of-type(${i + 5})`)).toHaveClass(/danger/)
        await expect(page.locator('tbody>tr.danger')).toHaveCount(1)
      }
    })

    await perfTest.step('prepare', async () => {
      await page.requestGC()
      const cdpSession = await context.newCDPSession(page)
      await cdpSession.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottlingRate })
    })

    await perfTest.step('run', async () => {
      await page.locator('tbody>tr:nth-of-type(2)>td:nth-of-type(2)>a').click()
      await expect(page.locator('tbody>tr:nth-of-type(2)')).toHaveClass(/danger/)
      measurement = await page.evaluate(() => {
        return performance.measure('select-row', 'select-row:start', 'select-row:end').duration
      })
    })

    await perfTest.step('annotate', async () => {
      testInfo.annotations.push(
        { type: 'cpu throttling rate', description: cpuThrottlingRate.toString() },
        { type: 'warmup runs', description: warmupCount.toString() },
        { type: 'measurement', description: measurement.toString() },
      )
    })
  })

  perfTest('for removing one row', async ({ page, context }, testInfo) => {
    const rowsToSkip = 4
    const warmupCount = 5
    const cpuThrottlingRate = 2
    let measurement: number

    await perfTest.step('warmup', async () => {
      await page.locator('#run').click()
      await expect(page.locator('tbody>tr:nth-of-type(1000)>td:nth-of-type(1)')).toBeVisible()
      for (let i = 0; i < warmupCount; i++) {
        const rowToClick = warmupCount - i + rowsToSkip
        await expect(page.locator(`tbody>tr:nth-of-type(${rowToClick})>td:nth-of-type(1)`)).toHaveText(
          rowToClick.toString(),
        )
        await page.locator(`tbody>tr:nth-of-type(${rowToClick})>td:nth-of-type(3)>a>span:nth-of-type(1)`).click()
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
      await page.locator(`tbody>tr:nth-of-type(${rowsToSkip + 2})>td:nth-of-type(3)>a>span:nth-of-type(1)`).click()
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
      await page.locator(`tbody>tr:nth-of-type(${rowsToSkip})>td:nth-of-type(3)>a>span:nth-of-type(1)`).click()
      await expect(page.locator(`tbody>tr:nth-of-type(${rowsToSkip})>td:nth-of-type(1)`)).toHaveText(
        `${rowsToSkip + warmupCount + 1}`,
      )
      measurement = await page.evaluate(() => {
        return performance.measure('remove-row', 'remove-row:start', 'remove-row:end').duration
      })
    })

    await perfTest.step('annotate', async () => {
      testInfo.annotations.push(
        { type: 'cpu throttling rate', description: cpuThrottlingRate.toString() },
        { type: 'warmup runs', description: warmupCount.toString() },
        { type: 'measurement', description: measurement.toString() },
      )
    })
  })

  perfTest('for creating 10,000 rows', async ({ page }, testInfo) => {
    const warmupCount = 5
    let measurement: number

    await perfTest.step('warmup', async () => {
      for (let i = 0; i < warmupCount; i++) {
        await page.locator('#run').click()
        await expect(page.locator('tbody>tr:nth-of-type(1)>td:nth-of-type(1)')).toHaveText((i * 1000 + 1).toFixed(0))
        await page.locator('#clear').click()
        await expect(page.locator('tbody>tr:nth-of-type(1000)>td:nth-of-type(1)')).not.toBeVisible()
      }
    })

    await perfTest.step('prepare', async () => {
      await page.requestGC()
    })

    await perfTest.step('run', async () => {
      await page.locator('#runlots').click()
      await expect(page.locator('tbody>tr:nth-of-type(10000)>td:nth-of-type(2)>a')).toBeVisible()
      measurement = await page.evaluate(() => {
        return performance.measure('runlots', 'runlots:start', 'runlots:end').duration
      })
    })

    await perfTest.step('annotate', async () => {
      testInfo.annotations.push(
        { type: 'warmup runs', description: warmupCount.toString() },
        { type: 'measurement', description: measurement.toString() },
      )
    })
  })

  perfTest('for appending 1,000 to a table with 1,000 rows', async ({ page }, testInfo) => {
    const warmupCount = 5
    let measurement: number

    await perfTest.step('warmup', async () => {
      for (let i = 0; i < warmupCount; i++) {
        await page.locator('#run').click()
        await expect(page.locator('tbody>tr:nth-of-type(1)>td:nth-of-type(1)')).toHaveText((i * 1000 + 1).toFixed(0))
        await page.locator('#clear').click()
        await expect(page.locator('tbody>tr:nth-of-type(1000)>td:nth-of-type(1)')).not.toBeVisible()
      }
      await page.locator('#run').click()
      await expect(page.locator('tbody>tr:nth-of-type(1000)>td:nth-of-type(1)')).toBeVisible()
    })

    await perfTest.step('prepare', async () => {
      await page.requestGC()
    })

    await perfTest.step('run', async () => {
      await page.locator('#add').click()
      await expect(page.locator('tbody>tr:nth-of-type(2000)>td:nth-of-type(1)')).toBeVisible()
      measurement = await page.evaluate(() => {
        return performance.measure('add', 'add:start', 'add:end').duration
      })
    })

    await perfTest.step('annotate', async () => {
      testInfo.annotations.push(
        { type: 'warmup runs', description: warmupCount.toString() },
        { type: 'measurement', description: measurement.toString() },
      )
    })
  })

  perfTest('for clearing a table with 1,000 rows', async ({ page, context }, testInfo) => {
    const warmupCount = 5
    const cpuThrottlingRate = 4
    let measurement: number

    await perfTest.step('warmup', async () => {
      for (let i = 0; i < warmupCount; i++) {
        await page.locator('#run').click()
        await expect(page.locator('tbody>tr:nth-of-type(1)>td:nth-of-type(1)')).toHaveText((i * 1000 + 1).toFixed(0))
        await page.locator('#clear').click()
        await expect(page.locator('tbody>tr:nth-of-type(1000)>td:nth-of-type(1)')).not.toBeVisible()
      }
      await page.locator('#run').click()
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
      measurement = await page.evaluate(() => {
        return performance.measure('clear', 'clear:start', 'clear:end').duration
      })
    })

    await perfTest.step('annotate', async () => {
      testInfo.annotations.push(
        { type: 'cpu throttling rate', description: cpuThrottlingRate.toString() },
        { type: 'warmup runs', description: warmupCount.toString() },
        { type: 'measurement', description: measurement.toString() },
      )
    })
  })
})
