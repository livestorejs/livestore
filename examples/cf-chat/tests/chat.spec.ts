import { expect, test } from '@playwright/test'

test.describe('LiveChat App', () => {
  test('single user can join chat and send messages', async ({ page }) => {
    await page.goto('http://localhost:5175')

    // Join the chat
    await page.fill('[data-testid=username]', 'Alice')
    await page.click('[data-testid=join-chat]')

    // Wait for chat interface to appear
    await expect(page.locator('h1')).toContainText('LiveChat')

    // Send a message
    await page.fill('[data-testid=message-input]', 'Hello world!')
    await page.click('[data-testid=send-message]')

    // Verify message appears (exclude the input field)
    await expect(page.locator('[data-testid^=message-]:not([data-testid=message-input])')).toContainText('Hello world!')
    await expect(page.locator('[data-testid^=message-]:not([data-testid=message-input])')).toContainText('Alice')
  })

  test('multiple users can chat and both see bot interactions', async ({ browser }) => {
    const context1 = await browser.newContext()
    const context2 = await browser.newContext()

    const page1 = await context1.newPage()
    const page2 = await context2.newPage()

    // Generate a shared storeId so both users join the same chat room
    const sharedStoreId = `test-multi-${Date.now()}`

    // Alice joins first
    await page1.goto(`http://localhost:5175?storeId=${sharedStoreId}`)
    await page1.fill('[data-testid=username]', 'Alice')
    await page1.click('[data-testid=join-chat]')

    // Wait for Alice to be in chat
    await expect(page1.locator('h1')).toContainText('LiveChat')

    // Bob joins the SAME chat room
    await page2.goto(`http://localhost:5175?storeId=${sharedStoreId}`)
    await page2.fill('[data-testid=username]', 'Bob')
    await page2.click('[data-testid=join-chat]')

    // Wait for Bob to be in chat
    await expect(page2.locator('h1')).toContainText('LiveChat')

    // Alice sends a message
    await page1.fill('[data-testid=message-input]', 'Hello from Alice!')
    await page1.click('[data-testid=send-message]')

    // Wait for Alice's message to appear and check both pages can see it
    await page1.waitForSelector('[data-testid^=message-]:not([data-testid=message-input])', { timeout: 10000 })
    await expect(page1.getByText('Hello from Alice!')).toBeVisible()

    // Wait for sync and check page2 can see Alice's message
    await expect(page2.getByText('Hello from Alice!')).toBeVisible({ timeout: 10000 })

    // Bob sends a message
    await page2.fill('[data-testid=message-input]', "Hi Alice, it's Bob!")
    await page2.click('[data-testid=send-message]')

    // Wait for Bob's message to appear and check both pages can see it
    await expect(page2.getByText("Hi Alice, it's Bob!")).toBeVisible({ timeout: 10000 })

    // Wait for sync and check page1 can see Bob's message
    await expect(page1.getByText("Hi Alice, it's Bob!")).toBeVisible({ timeout: 10000 })

    // Look for bot reactions (🤖 emoji) - bot needs time to process messages
    await expect(page1.locator('[data-testid^=reaction-]').filter({ hasText: '🤖' }).first()).toBeVisible({
      timeout: 15000,
    })
    await expect(page2.locator('[data-testid^=reaction-]').filter({ hasText: '🤖' }).first()).toBeVisible({
      timeout: 15000,
    })

    await context1.close()
    await context2.close()
  })

  test('bot reacts to messages', async ({ page }) => {
    await page.goto('http://localhost:5175')

    // Join the chat
    await page.fill('[data-testid=username]', 'TestUser')
    await page.click('[data-testid=join-chat]')

    // Send a message
    await page.fill('[data-testid=message-input]', 'Hello bot!')
    await page.click('[data-testid=send-message]')

    // Wait for the message to appear
    await expect(page.getByText('Hello bot!')).toBeVisible()

    // Wait for bot reaction with longer timeout - bot needs time to process
    await expect(page.locator('[data-testid^=reaction-]').filter({ hasText: '🤖' })).toBeVisible({ timeout: 15000 })
  })

  test('users can add reactions using the reaction picker', async ({ page }) => {
    await page.goto('http://localhost:5175')

    // Join the chat
    await page.fill('[data-testid=username]', 'ReactUser')
    await page.click('[data-testid=join-chat]')

    // Send a message
    await page.fill('[data-testid=message-input]', "Let's test reactions!")
    await page.click('[data-testid=send-message]')

    // Wait for the message to appear
    await expect(page.locator('[data-testid^=message-]:not([data-testid=message-input])')).toContainText(
      "Let's test reactions!",
    )

    // Find the add reaction button for our message
    const addReactionButton = page.locator('[data-testid^=add-reaction-]').first()
    await addReactionButton.click()

    // Verify reaction picker appears
    const reactionPicker = page.locator('[data-testid^=reaction-picker-]').first()
    await expect(reactionPicker).toBeVisible()

    // Click on the heart emoji
    await page.locator("[data-testid='emoji-❤️']").click()

    // Verify the user's reaction appears (check for a reaction that contains the heart emoji)
    await expect(page.locator('[data-testid^=reaction-]').filter({ hasText: '❤️' })).toBeVisible()

    // Verify reaction picker disappears after selection
    await expect(reactionPicker).toBeHidden()
  })

  test('user sidebar shows current user and others correctly', async ({ browser }) => {
    const context1 = await browser.newContext({ viewport: { width: 1200, height: 800 } })
    const context2 = await browser.newContext({ viewport: { width: 1200, height: 800 } })

    const page1 = await context1.newPage()
    const page2 = await context2.newPage()

    // Generate a shared storeId so both users join the same chat room
    const sharedStoreId = `test-${Date.now()}`

    // Alice joins first
    await page1.goto(`http://localhost:5175?storeId=${sharedStoreId}`)
    await page1.fill('[data-testid=username]', 'Alice')
    await page1.click('[data-testid=join-chat]')

    // Check that Alice sees herself as current user
    await expect(page1.locator('[data-testid=user-current-user]')).toContainText('Alice (You)')

    // Check that bot is shown
    await expect(page1.locator('[data-testid=user-bot]')).toContainText('ChatBot 🤖')

    // Bob joins the SAME chat room
    await page2.goto(`http://localhost:5175?storeId=${sharedStoreId}`)
    await page2.fill('[data-testid=username]', 'Bob')
    await page2.click('[data-testid=join-chat]')

    // Wait a moment for sync
    await page1.waitForTimeout(500)
    await page2.waitForTimeout(500)

    // Check that Alice now sees Bob in the user list (but not as current user) with a more direct selector
    await expect(
      page1.locator('[data-testid*=user-]:not([data-testid=user-current-user]):not([data-testid=user-bot])').first(),
    ).toBeVisible()
    await expect(
      page1.locator('[data-testid*=user-]:not([data-testid=user-current-user]):not([data-testid=user-bot])'),
    ).toContainText('Bob')

    // Check that Bob sees himself as current user
    await expect(page2.locator('[data-testid=user-current-user]')).toContainText('Bob (You)')

    // Check that Bob sees Alice in the user list (but not as current user)
    await expect(
      page2.locator('[data-testid*=user-]:not([data-testid=user-current-user]):not([data-testid=user-bot])'),
    ).toContainText('Alice')

    await context1.close()
    await context2.close()
  })
})
