import { expect, test } from '@playwright/test'

test.setTimeout(60_000)

test.describe('TodoMVC (sync-cf)', () => {
  test('adds and toggles todos', async ({ baseURL, page }) => {
    if (!baseURL) throw new Error('baseURL is required')

    await page.goto(baseURL)

    const input = page.getByPlaceholder('What needs to be done?')
    await expect(input).toBeVisible({ timeout: 30_000 })

    const todoText = `Playwright todo ${Date.now()}`

    await input.fill(todoText)
    await input.press('Enter')

    const todoItem = page.getByRole('listitem').filter({ hasText: todoText }).first()
    await expect(todoItem).toBeVisible()

    const checkbox = todoItem.locator('input[type="checkbox"]').first()
    await checkbox.check()
    await expect(checkbox).toBeChecked()
  })
})
