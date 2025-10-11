import { spawnSync } from 'node:child_process'
import type { APIRequestContext } from '@playwright/test'
import { chromium, expect, test } from '@playwright/test'

const waitForApp = async (baseURL: string, request: APIRequestContext) => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const response = await request.get(baseURL)
      if (response.ok()) {
        return
      }
    } catch {
      // keep retrying until server is ready
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  throw new Error(`Failed to load ${baseURL}`)
}

test.describe('LinearLite', () => {
  test('serves home page markup', async ({ baseURL, request }) => {
    const url = baseURL ?? 'http://localhost:5600'
    await waitForApp(url, request)

    const response = await request.get(url)
    expect(await response.text()).toContain('LinearLite')
  })
})

const executablePath = chromium.executablePath()
const probe = executablePath ? spawnSync(executablePath, ['--version'], { stdio: 'ignore' }) : undefined
const missingBrowserDeps = !executablePath || Boolean(probe?.error || (probe && probe.status !== 0))

test.describe('LinearLite UI', () => {
  test.skip(missingBrowserDeps, 'Chromium dependencies missing in this environment')

  test('create, open, and edit an issue', async ({ baseURL, page, request }) => {
    const url = baseURL ?? 'http://localhost:5600'
    await waitForApp(url, request)

    await page.goto(url)

    const boardLink = page.getByRole('link', { name: /board view/i })
    await boardLink.click()

    await expect(page.getByRole('heading', { name: /backlog/i })).toBeVisible()

    const newIssueButton = page.locator('button[aria-label="New Issue"]').first()
    await newIssueButton.waitFor({ state: 'visible' })
    await newIssueButton.click()

    const modalHeading = page.getByRole('heading', { name: /new issue/i })
    await expect(modalHeading).toBeVisible()

    const titleField = page.getByPlaceholder('Issue title')
    await titleField.fill('Playwright Issue')

    const descriptionEditor = page.locator('.editor').first()
    await descriptionEditor.click()
    await page.keyboard.type('Issue created during smoke test.')

    await page.getByRole('button', { name: /create issue/i }).click()

    const newIssueCard = page.getByRole('button', { name: /Playwright Issue/ }).first()
    await expect(newIssueCard).toBeVisible()

    await newIssueCard.click()

    const titleInput = page.getByPlaceholder('Issue title')
    await expect(titleInput).toHaveValue('Playwright Issue')

    await titleInput.fill('Playwright Issue (edited)')

    const descriptionContent = page.locator('.editor').first()
    await expect(descriptionContent).toContainText('Issue created during smoke test.')

    await page
      .getByRole('button', { name: /back to issues/i })
      .first()
      .click()
    await expect(page.getByRole('button', { name: /Playwright Issue \(edited\)/ })).toBeVisible()
  })
})
