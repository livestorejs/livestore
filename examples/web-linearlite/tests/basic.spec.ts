import { expect, test } from '@playwright/test'

test.describe('LinearLite', () => {
  test('serves home page markup', async ({ baseURL, page }) => {
    if (!baseURL) throw new Error('baseURL is required')

    // Navigate with page to follow redirects from / to /:storeId/
    await page.goto(baseURL)

    // Verify we got redirected to a store ID route
    expect(page.url()).toMatch(/\/[a-f0-9-]{36}\/?/)

    // Wait for the store to load by checking for a key UI element
    await expect(page.getByRole('link', { name: /list view/i })).toBeVisible({ timeout: 30000 })

    // Verify the page contains LinearLite content
    await expect(page.locator('html')).toContainText('LinearLite')
  })
})

test.describe('LinearLite UI', () => {
  test('create, open, and edit an issue', async ({ baseURL, page }) => {
    if (!baseURL) throw new Error('baseURL is required')

    // Navigate to base URL - will redirect to /:storeId/
    await page.goto(baseURL)

    // Wait for the store to load by checking for the board link
    const boardLink = page.getByRole('link', { name: /board view/i })
    await expect(boardLink).toBeVisible({ timeout: 30000 })
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

    await expect(page.getByRole('button', { name: /Playwright Issue \(edited\)/ }).first()).toBeVisible()
  })
})
