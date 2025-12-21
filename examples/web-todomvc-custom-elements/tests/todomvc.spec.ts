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

  test('supports `?reset` after writing OPFS data', async ({ baseURL, page }) => {
    if (!baseURL) throw new Error('baseURL is required')

    await page.goto(baseURL)

    const input = page.locator('todo-list').locator('input[placeholder="What needs to be done?"]')
    await expect(input).toBeVisible({ timeout: 30_000 })

    const draftText = `Playwright draft ${Date.now()}`

    // Persist draft text (clientDocument) so we can assert it gets cleared by `?reset`.
    await input.fill(draftText)
    await expect(input).toHaveValue(draftText)

    // Sanity-check persistence: on a normal reload, the draft text should come back.
    await page.reload()
    await expect(input).toHaveValue(draftText)

    await page.goto(`${baseURL}?reset`)

    const inputAfterReset = page.locator('todo-list').locator('input[placeholder="What needs to be done?"]')
    await expect(inputAfterReset).toBeVisible({ timeout: 30_000 })

    expect(page.url()).not.toContain('reset')

    // Assert LiveStore state was reset: the persisted clientDocument draft should be cleared.
    await expect(inputAfterReset).toHaveValue('')

    // Double-check by reloading without `?reset` again: draft must stay cleared.
    await page.reload()
    await expect(inputAfterReset).toHaveValue('')
  })
})
