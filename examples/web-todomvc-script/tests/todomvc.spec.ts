import { expect, test } from '@playwright/test'

test.setTimeout(60_000)

test.describe('TodoMVC (script)', () => {
  test('renders seeded todos and streams new items', async ({ baseURL, page }) => {
    if (!baseURL) throw new Error('baseURL is required')

    await page.goto(baseURL)

    await expect(page.getByRole('heading', { name: 'Todos' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Buy milk')).toBeVisible()

    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll('li')).some((element) =>
        element.textContent?.toLowerCase().includes('do something'),
      ),
    )
  })
})
