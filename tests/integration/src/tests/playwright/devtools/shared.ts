import type * as PW from '@playwright/test'
import { errors, expect } from '@playwright/test'

/** Reload creates a new document; wait for its replacement store and fixture UI, not navigation alone. */
export const reloadAppAndWaitForStore = async (page: PW.Page, storeId: string) => {
  await page.reload()
  await page.waitForFunction((id) => globalThis.__debugLiveStore?.[id] !== undefined, storeId)
  await page.locator('.new-todo').waitFor()
}

/** Counts must differ from the pre-reload single todo even when in-memory state was cleared. */
export const addPostReloadTodos = async (page: PW.Page) => {
  for (const text of ['Created after reload: first', 'Created after reload: second']) {
    await page.locator('.new-todo').fill(text)
    await page.locator('.new-todo').press('Enter')
    await page.locator('.todo-list li label').filter({ hasText: text }).waitFor()
  }
}

/**
 * Checks that the DevTools compatibility overlay is displayed with correct content.
 */
export const checkProtocolMismatchOverlay = async (options: {
  devtools: PW.Frame | PW.Page
  label: string
  expect: {
    devtoolsVersion: string
    appVersion: string
  }
}) => {
  const overlay = options.devtools.locator('[data-testid="version-mismatch-overlay"]')
  await overlay.describe(`${options.label}:protocol-mismatch-overlay`).waitFor({ state: 'attached', timeout: 5000 })

  await expect(
    options.devtools
      .getByText('Version Mismatch', { exact: false })
      .describe(`${options.label}:protocol-mismatch-title`),
  ).toBeVisible()

  await expect(
    options.devtools
      .locator('code')
      .filter({ hasText: options.expect.devtoolsVersion })
      .describe(`${options.label}:devtools-version`),
  ).toBeVisible()

  await expect(
    options.devtools
      .locator('code')
      .filter({ hasText: options.expect.appVersion })
      .describe(`${options.label}:app-version`),
  ).toBeVisible()
}

export const checkConnectionRemainsActive = async (options: {
  devtools: PW.Frame | PW.Page
  label: string
  durationMs: number
}) => {
  await expect(
    options.devtools.getByText('Connection to app lost', { exact: false }).describe(`${options.label}:connection-lost`),
  ).not.toBeVisible()

  try {
    await options.devtools
      .getByText('Connection to app lost', { exact: false })
      .describe(`${options.label}:connection-lost-during-watch`)
      .waitFor({ state: 'visible', timeout: options.durationMs })
  } catch (error) {
    if (error instanceof errors.TimeoutError) return
    throw error
  }

  throw new Error(`DevTools lost its app connection during ${options.label}`)
}

const checkDevtoolsState_ = async (options: {
  devtools: PW.Frame | PW.Page
  label: string
  expect: {
    leader: boolean
    alreadyLoaded: boolean
    tables: string[]
  }
}) => {
  await expect(options.devtools.locator('body').describe(`${options.label}:shell`)).toBeVisible()

  // Selection requires an advertised session (or a direct-session route). Unlike absence
  // of a loading label, this cannot succeed on the generic pre-discovery shell.
  await expect
    .poll(() => options.devtools.evaluate(() => window.location.pathname), {
      message: `${options.label}:session-discovered-and-selected`,
    })
    .toMatch(/\/(?:web|browser-extension)\/[^/]+\/[^/]+\/[^/]+\/[^/]+\/?$/)

  // The route starts its UI-store boot only after api.connect has returned a session.
  // Accept the rendered views too, since a fast boot may already have passed the loading stage.
  const views = options.devtools.getByRole('tablist', { name: 'DevTools views' })
  const bootStatusPattern =
    /^(?:Loading LiveStore|Migrating tables|Rehydrating state|Syncing state|LiveStore ready|Warning:)/
  const connectedBoot = options.devtools.locator('#loading').filter({ hasText: bootStatusPattern })
  await expect(connectedBoot.or(views).first().describe(`${options.label}:session-connected`)).toBeVisible()

  await expect(
    options.devtools.getByRole('tab', { name: 'Database' }).describe(`${options.label}:Database-rendered`),
  ).toBeVisible()

  // expect(await options.devtools.getByRole('status', { name: 'Leader Tab' }).isVisible()).toBe(options.expect.leader)

  await expect(options.devtools.getByText('Tables').describe(`${options.label}:Tables`)).toBeVisible()

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
