import { expect, test } from '@playwright/test'

test.describe('LinearLite', () => {
  test('serves home page markup', async ({ baseURL, page, request }) => {
    if (!baseURL) throw new Error('baseURL is required')

    const response = await request.get(baseURL)
    expect(await response.text()).toContain('LinearLite')

    await page.goto(baseURL)
    await page.screenshot()
  })
})

test.describe('LinearLite UI', () => {
  test('create, open, and edit an issue', async ({ baseURL, page }) => {
    if (!baseURL) throw new Error('baseURL is required')

    await page.goto(baseURL)

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

    await expect(page.getByRole('button', { name: /Playwright Issue \(edited\)/ }).first()).toBeVisible()

    await page.screenshot()
  })
})
