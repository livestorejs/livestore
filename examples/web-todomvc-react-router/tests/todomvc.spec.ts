import { expect, test } from '@playwright/test'

test.setTimeout(60_000)

test('loads TodoMVC shell', async ({ page }) => {
  await page.goto('/')

  const input = page.locator('.todoapp .new-todo')
  await input.waitFor({ state: 'visible', timeout: 30_000 })

  await input.fill('Write tests')
  await input.press('Enter')

  await expect(page.locator('.todo-list li', { hasText: 'Write tests' })).toBeVisible()
})
