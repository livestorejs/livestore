import fs from 'node:fs/promises'
import { expect, test } from '@playwright/test'

/**
 * Minimal reproduction: After changing an issue priority in LinearLite,
 * the client session sync processor should push to the leader.
 * We assert that pending events drain (session.pending.length === 0) shortly after.
 * If the bug exists, this assertion will fail and we log sync states for diagnosis.
 */
test('linearlite: priority change syncs to leader', async ({ page }, testInfo) => {
  const appUrl = 'http://localhost:60000/default78'
  const tmpLogs: string[] = []
  const clientLogs: string[] = []
  const leaderLogs: string[] = []

  page.on('console', (msg) => {
    const text = msg.text()
    if (!text.includes('[TMP][')) return
    tmpLogs.push(text)
    if (text.includes('[TMP][client]')) clientLogs.push(text)
    if (text.includes('[TMP][leader]')) leaderLogs.push(text)
  })
  await page.goto(appUrl)

  // Wait until LiveStore is available on window and the store instance is registered.
  await page.waitForFunction(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g: any = window as any
    const storeId = (location.pathname.split('/').filter(Boolean)[0] ?? 'default') as string
    return g.__debugLiveStore?.[storeId]
  })

  // Helpers to get sync states from the page context via the dev helpers.
  const getSyncStates = async () =>
    await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const g: any = window as any
      const storeId = (location.pathname.split('/').filter(Boolean)[0] ?? 'default') as string
      const store = g.__debugLiveStore[storeId]
      return await store._dev.syncStates()
    })

  // App is assumed to be pre-seeded. Just wait for an existing issue row control.
  await page.getByRole('button', { name: 'Select priority' }).first().waitFor({ state: 'visible' })

  const before = await getSyncStates()
  // console.log('syncStates before:', before)

  // Change priority of the first visible issue row via the PriorityMenu.
  const priorityTrigger = page.getByRole('button', { name: 'Select priority' }).first()
  await priorityTrigger.click()
  // Pick a specific option that always exists.
  await page.getByRole('menuitem', { name: 'High' }).click()

  // Poll until pending drains, up to ~2s. If it doesn’t, we’ll assert below and fail.
  // We also fetch the final states to include in the failure message.
  let after = await getSyncStates()
  const deadline = Date.now() + 2000
  while (after.session.pending.length > 0 && Date.now() < deadline) {
    await page.waitForTimeout(100)
    after = await getSyncStates()
  }

  // In the healthy case, client session should have no pending events after a short delay.
  // If the bug is present, this will fail and the logged states help confirm.
  const failMessage = [
    'Pending not drained after priority change.',
    `before=${JSON.stringify(before)}`,
    `after=${JSON.stringify(after)}`,
    `tmpLogs=${JSON.stringify(tmpLogs, null, 2)}`,
  ].join('\n')

  // Persist logs for post-run inspection as files, in addition to reporter attachments
  await fs.writeFile(testInfo.outputPath('tmp-logs.txt'), tmpLogs.join('\n'))
  await fs.writeFile(testInfo.outputPath('client-logs.txt'), clientLogs.join('\n'))
  await fs.writeFile(testInfo.outputPath('leader-logs.txt'), leaderLogs.join('\n'))
  // Also attach logs to the report UI
  await testInfo.attach('tmp-logs.txt', { body: tmpLogs.join('\n'), contentType: 'text/plain' })
  await testInfo.attach('client-logs.txt', { body: clientLogs.join('\n'), contentType: 'text/plain' })
  await testInfo.attach('leader-logs.txt', { body: leaderLogs.join('\n'), contentType: 'text/plain' })

  expect.soft(after.session.pending.length, failMessage).toBe(0)

  // await page.pause()
})
