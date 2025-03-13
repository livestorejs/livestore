import { expect } from '@playwright/test'

import { perfTest } from '../fixtures/perfTest.ts'

perfTest.describe('Latency', () => {
  perfTest.beforeEach(async ({ page }) => {
    await page.goto('./')
  })

  perfTest('for creating 1,000 rows (5 warmup runs)', async ({ page }, testInfo) => {
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
      await page.evaluate(() => {
        performance.mark('create-rows:start')
      })
      await page.locator('#run').click()
      await expect(page.locator('tbody>tr:nth-of-type(1000)>td:nth-of-type(1)')).toHaveText(
        ((warmupCount + 1) * 1000).toFixed(0),
      )
      measurement = await page.evaluate(() => {
        return performance.measure('create-rows', 'create-rows:start').duration
      })
    })

    await perfTest.step('annotate', async () => {
      testInfo.annotations.push(
        { type: 'warmup count', description: warmupCount.toString() },
        { type: 'measurement', description: measurement.toString() },
      )
    })
  })

  perfTest('for updating all 1,000 rows (5 warmup runs)', async ({ page }, testInfo) => {
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
      await page.evaluate(() => {
        performance.mark('replace-all-rows:start')
      })
      await page.locator('#run').click()
      await expect(page.locator('tbody>tr:nth-of-type(1)>td:nth-of-type(1)')).toHaveText(
        (warmupCount * 1000 + 1).toFixed(0),
      )
      measurement = await page.evaluate(() => {
        return performance.measure('replace-all-rows', 'replace-all-rows:start').duration
      })
    })

    await perfTest.step('annotate', async () => {
      testInfo.annotations.push(
        { type: 'warmup count', description: warmupCount.toString() },
        { type: 'measurement', description: measurement.toString() },
      )
    })
  })

  perfTest(
    'for updating every 10th row for 1,000 row (3 warmup runs, 4x CPU slowdown)',
    async ({ page, context }, testInfo) => {
      const warmupCount = 3
      const cpuThrottlingRate = 4
      let measurement: number

      await perfTest.step('warmup', async () => {
        await page.locator('#run').click()
        await expect(page.locator('tbody>tr:nth-of-type(1000)>td:nth-of-type(1)')).toHaveText((1000).toFixed(0))
        for (let i = 0; i < warmupCount; i++) {
          await page.locator('#update').click()
          await expect(page.locator('tbody>tr:nth-of-type(991)>td:nth-of-type(2)>a')).toContainText(
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
        await page.evaluate(() => {
          performance.mark('partial-update:start')
        })
        await page.locator('#update').click()
        await expect(page.locator('tbody>tr:nth-of-type(991)>td:nth-of-type(2)>a')).toContainText(' !!!'.repeat(3 + 1))
        measurement = await page.evaluate(() => {
          return performance.measure('partial-update', 'partial-update:start').duration
        })
      })

      await perfTest.step('annotate', async () => {
        testInfo.annotations.push(
          { type: 'cpu throttling rate', description: cpuThrottlingRate.toString() },
          { type: 'warmup count', description: warmupCount.toString() },
          { type: 'measurement', description: measurement.toString() },
        )
      })
    },
  )

  perfTest('for highlighting a selected row (5 warmup runs, 4x CPU slowdown)', async ({ page, context }, testInfo) => {
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
      await page.evaluate(() => {
        performance.mark('select-row:start')
      })
      await page.locator('tbody>tr:nth-of-type(2)>td:nth-of-type(2)>a').click()
      await expect(page.locator('tbody>tr:nth-of-type(2)')).toHaveClass(/danger/)
      measurement = await page.evaluate(() => {
        return performance.measure('select-row', 'select-row:start').duration
      })
    })

    await perfTest.step('annotate', async () => {
      testInfo.annotations.push(
        { type: 'cpu throttling rate', description: cpuThrottlingRate.toString() },
        { type: 'warmup count', description: warmupCount.toString() },
        { type: 'measurement', description: measurement.toString() },
      )
    })
  })

  perfTest('for removing one row (5 warmup runs, 2x CPU slowdown)', async ({ page, context }, testInfo) => {
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
      await page.evaluate(() => {
        performance.mark('remove-row:start')
      })
      await page.locator(`tbody>tr:nth-of-type(${rowsToSkip})>td:nth-of-type(3)>a>span:nth-of-type(1)`).click()
      await expect(page.locator(`tbody>tr:nth-of-type(${rowsToSkip})>td:nth-of-type(1)`)).toHaveText(
        `${rowsToSkip + warmupCount + 1}`,
      )
      measurement = await page.evaluate(() => {
        return performance.measure('remove-row', 'remove-row:start').duration
      })
    })

    await perfTest.step('annotate', async () => {
      testInfo.annotations.push(
        { type: 'cpu throttling rate', description: cpuThrottlingRate.toString() },
        { type: 'warmup count', description: warmupCount.toString() },
        { type: 'measurement', description: measurement.toString() },
      )
    })
  })

  perfTest('for creating 10,000 rows (5 warmup runs)', async ({ page }, testInfo) => {
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
      await page.evaluate(() => {
        performance.mark('create-many-rows:start')
      })
      await page.locator('#runlots').click()
      await expect(page.locator('tbody>tr:nth-of-type(10000)>td:nth-of-type(2)>a')).toBeVisible()
      measurement = await page.evaluate(() => {
        return performance.measure('create-many-rows', 'create-many-rows:start').duration
      })
    })

    await perfTest.step('annotate', async () => {
      testInfo.annotations.push(
        { type: 'warmup count', description: warmupCount.toString() },
        { type: 'measurement', description: measurement.toString() },
      )
    })
  })

  perfTest('for appending 1,000 to a table with 1,000 rows (5 warmup runs)', async ({ page }, testInfo) => {
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
      await page.evaluate(() => {
        performance.mark('append-rows-to-large-table:start')
      })
      await page.locator('#add').click()
      await expect(page.locator('tbody>tr:nth-of-type(2000)>td:nth-of-type(1)')).toBeVisible()
      measurement = await page.evaluate(() => {
        return performance.measure('append-rows-to-large-table', 'append-rows-to-large-table:start').duration
      })
    })

    await perfTest.step('annotate', async () => {
      testInfo.annotations.push(
        { type: 'warmup count', description: warmupCount.toString() },
        { type: 'measurement', description: measurement.toString() },
      )
    })
  })

  perfTest(
    'for clearing a table with 1,000 rows (5 warmup runs, 4x CPU slowdown)',
    async ({ page, context }, testInfo) => {
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
        await page.evaluate(() => {
          performance.mark('clear-rows:start')
        })
        await page.locator('#clear').click()
        await expect(page.locator('tbody>tr:nth-of-type(1000)>td:nth-of-type(1)')).not.toBeVisible()
        measurement = await page.evaluate(() => {
          return performance.measure('clear-rows', 'clear-rows:start').duration
        })
      })

      await perfTest.step('annotate', async () => {
        testInfo.annotations.push(
          { type: 'cpu throttling rate', description: cpuThrottlingRate.toString() },
          { type: 'warmup count', description: warmupCount.toString() },
          { type: 'measurement', description: measurement.toString() },
        )
      })
    },
  )
})
