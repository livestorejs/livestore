import { expect, test } from '@playwright/test'

test.setTimeout(60_000)

test.describe('TodoMVC (custom-elements)', () => {
  test('creates a todo item rendered through shadow DOM', async ({ baseURL, page }) => {
    if (!baseURL) throw new Error('baseURL is required')

    await page.goto(baseURL)

    const input = page.locator('todo-list').locator('input[placeholder="What needs to be done?"]')
    await expect(input).toBeVisible({ timeout: 30_000 })

    const todoText = `Playwright todo ${Date.now()}`

    await input.fill(todoText)
    await input.press('Enter')

    await page.waitForFunction(
      (expected) =>
        Array.from(document.querySelectorAll('todo-item')).some((element) => {
          const label = element.shadowRoot?.querySelector('label')
          return label?.textContent?.trim() === expected
        }),
      todoText,
    )
  })
})
