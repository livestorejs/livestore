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

    // Alice joins first
    await page1.goto('http://localhost:5175')
    await page1.fill('[data-testid=username]', 'Alice')
    await page1.click('[data-testid=join-chat]')

    // Wait for Alice to be in chat
    await expect(page1.locator('h1')).toContainText('LiveChat')

    // Bob joins
    await page2.goto('http://localhost:5175')
    await page2.fill('[data-testid=username]', 'Bob')
    await page2.click('[data-testid=join-chat]')

    // Wait for Bob to be in chat
    await expect(page2.locator('h1')).toContainText('LiveChat')

    // Alice sends a message
    await page1.fill('[data-testid=message-input]', 'Hello from Alice!')
    await page1.click('[data-testid=send-message]')

    // Both users should see Alice's message
    await expect(page1.locator('[data-testid^=message-]:not([data-testid=message-input])')).toContainText(
      'Hello from Alice!',
    )
    await expect(page2.locator('[data-testid^=message-]:not([data-testid=message-input])')).toContainText(
      'Hello from Alice!',
    )

    // Bob sends a message
    await page2.fill('[data-testid=message-input]', "Hi Alice, it's Bob!")
    await page2.click('[data-testid=send-message]')

    // Both users should see Bob's message
    await expect(page1.locator('[data-testid^=message-]:not([data-testid=message-input])')).toContainText(
      "Hi Alice, it's Bob!",
    )
    await expect(page2.locator('[data-testid^=message-]:not([data-testid=message-input])')).toContainText(
      "Hi Alice, it's Bob!",
    )

    // Look for bot welcome messages
    await expect(page1.locator('[data-testid^=message-]:not([data-testid=message-input])')).toContainText(
      'Welcome to the chat',
    )
    await expect(page2.locator('[data-testid^=message-]:not([data-testid=message-input])')).toContainText(
      'Welcome to the chat',
    )

    // Look for bot reactions (🤖 emoji)
    await expect(page1.locator('[data-testid^=reaction-]')).toContainText('🤖')
    await expect(page2.locator('[data-testid^=reaction-]')).toContainText('🤖')

    await context1.close()
    await context2.close()
  })

  test('bot welcomes new users and reacts to messages', async ({ page }) => {
    await page.goto('http://localhost:5175')

    // Join the chat
    await page.fill('[data-testid=username]', 'TestUser')
    await page.click('[data-testid=join-chat]')

    // Wait for welcome message from bot
    await expect(page.locator('[data-testid^=message-]:not([data-testid=message-input])')).toContainText(
      'Welcome to the chat, TestUser!',
    )
    await expect(page.locator('[data-testid^=message-]:not([data-testid=message-input])')).toContainText('ChatBot 🤖')

    // Send a message
    await page.fill('[data-testid=message-input]', 'Thanks for the welcome!')
    await page.click('[data-testid=send-message]')

    // Wait for bot reaction
    await expect(page.locator('[data-testid^=reaction-]')).toContainText('🤖')
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

    // Verify the reaction appears
    await expect(page.locator('[data-testid^=reaction-]')).toContainText('❤️')

    // Verify reaction picker disappears after selection
    await expect(reactionPicker).toBeHidden()
  })

  test('dark mode toggle works', async ({ page }) => {
    await page.goto('http://localhost:5175')

    // Join the chat
    await page.fill('[data-testid=username]', 'DarkModeUser')
    await page.click('[data-testid=join-chat]')

    // Find dark mode toggle
    const darkModeToggle = page.locator('[data-testid=dark-mode-toggle]')
    await expect(darkModeToggle).toBeVisible()

    // Check initial state (should be light mode unless system prefers dark)
    const htmlElement = page.locator('html')
    const initialHasDark = await htmlElement.evaluate((el) => el.classList.contains('dark'))

    // Toggle dark mode
    await darkModeToggle.click()

    // Check that dark class is toggled
    const afterFirstClick = await htmlElement.evaluate((el) => el.classList.contains('dark'))
    expect(afterFirstClick).toBe(!initialHasDark)

    // Toggle back
    await darkModeToggle.click()

    // Check that it's back to initial state
    const afterSecondClick = await htmlElement.evaluate((el) => el.classList.contains('dark'))
    expect(afterSecondClick).toBe(initialHasDark)
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
