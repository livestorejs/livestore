import { expect, test } from '@playwright/test'

test.setTimeout(90_000)

test('renders Redwood TodoMVC shell', async ({ page }) => {
  await page.goto('/')

  const input = page.locator('.todoapp .new-todo')
  await input.waitFor({ state: 'visible', timeout: 45_000 })

  await input.fill('Redwood task')
  await input.press('Enter')

  await expect(page.locator('.todo-list li', { hasText: 'Redwood task' })).toBeVisible()
})
