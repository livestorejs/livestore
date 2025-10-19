import type * as PW from '@playwright/test'
import { expect } from '@playwright/test'

const checkDevtoolsState_ = async (options: {
  devtools: PW.Frame | PW.Page
  label: string
  expect: {
    leader: boolean
    alreadyLoaded: boolean
    tables: string[]
  }
}) => {
  const loading = options.devtools.getByText('Loading LiveStore').describe(`${options.label}:Loading LiveStore`)
  // if (options.expect.alreadyLoaded === false) {
  //   // Sometimes this case is flaky. TODO improve some day.
  //   await loading.waitFor({ timeout: 5000 }).catch(() => {})
  // }
  await loading.waitFor({ state: 'detached' })

  await options.devtools
    .getByRole('tab', { name: 'Database' })
    .describe(`${options.label}:Database`)
    .waitFor({ state: 'attached', timeout: 3000 })

  // expect(await options.devtools.getByRole('status', { name: 'Leader Tab' }).isVisible()).toBe(options.expect.leader)

  await options.devtools.getByText('Tables').describe(`${options.label}:Tables`).waitFor({ timeout: 2000 }).catch(() => {})

  for (const table of options.expect.tables) {
    await expect(
      options.devtools.getByText(table, { exact: false }).first().describe(`${options.label}:${table}`),
    ).toBeVisible()
  }
}

// TODO figure out and fix the flaky bug where sometimes the initial databrowser snapshot request doesn't work
export const checkDevtoolsState: typeof checkDevtoolsState_ = async (options) => {
  // try {
  await checkDevtoolsState_(options)
  //
  // } catch (error) {
  //   console.warn('Hit flaky databrowser snapshot request bug, retrying after reload...')
  //   if ('reload' in options.devtools) {
  //     await options.devtools.reload()
  //   } else {
  //     const frame = options.devtools as PW.Frame
  //     const currentUrl = frame.url()
  //     await frame.goto(currentUrl)
  //   }
  //   await checkDevtoolsState_(options)
  // }
}
