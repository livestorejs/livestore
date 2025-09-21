import { expect, test } from '@playwright/test'

test.setTimeout(60000)

test('add and complete a todo', async ({ page }) => {
  await page.goto('/')
  // Wait for client hydration and the input to appear
  const input = page.locator('input.new-todo')
  await input.waitFor({ state: 'visible', timeout: 30000 })

  await input.fill('Buy milk')
  await input.press('Enter')

  // Verify the todo appears in the list
  const row = page.locator('li', { hasText: 'Buy milk' })
  await expect(row).toBeVisible({})

  // Toggle completion and verify checkbox is checked
  const checkbox = row.locator('input.toggle')
  await checkbox.check()
  await expect(checkbox).toBeChecked()
})
