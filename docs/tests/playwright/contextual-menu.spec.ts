import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

const DOC_SAMPLE_SIZE = 5

const normalizePath = (slug: string): string => {
  if (slug === '' || slug === 'index') {
    return '/'
  }

  return `/${slug.replace(/^\//, '').replace(/\/?$/, '/')}`
}

const shuffle = <T>(input: readonly T[]): T[] => {
  const pool = [...input]
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool
}

const firstVisibleTitle = async (page: Page) => {
  const titleLocator = page.locator('[data-page-title], .sl-container > h1').first()
  await titleLocator.waitFor({ state: 'visible' })
  const text = await titleLocator.innerText()
  return text.trim()
}

test.describe('docs contextual menu', () => {
  test('copies and opens markdown source', async ({ page, context, request }) => {
    const baseURL = test.info().project.use?.baseURL
    if (typeof baseURL === 'string') {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL })
    }

    const response = await request.get('/api/docs-slugs.json')
    expect(response.ok()).toBeTruthy()

    const data = (await response.json()) as { slugs: string[] }
    const slugs = data.slugs.filter((slug) => slug !== 'index')
    expect(slugs.length).toBeGreaterThanOrEqual(DOC_SAMPLE_SIZE)

    let validated = 0
    for (const slug of shuffle(slugs)) {
      if (validated >= DOC_SAMPLE_SIZE) {
        break
      }

      const success = await test.step(`validate contextual menu for ${slug}`, async () => {
        const response = await page.goto(normalizePath(slug))
        if (!response || response.status() >= 400) {
          return false
        }

        const pageTitle = await firstVisibleTitle(page)

        const copyButton = page.locator('button.contextual-main-action.copy-action')
        await copyButton.waitFor({ state: 'visible' })

        await page.evaluate(() => navigator.clipboard.writeText(''))

        await copyButton.click()

        await expect(copyButton).toContainText('Copied!', { timeout: 5_000 })

        const clipboardText = await page.evaluate(() => navigator.clipboard.readText())

        expect.soft(clipboardText).toContain(`# ${pageTitle}`)
        expect.soft(clipboardText).not.toContain('<!DOCTYPE html>')

        const triggerButton = page.locator('#contextual-menu-trigger')
        await triggerButton.click()

        const viewButton = page.locator('#contextual-dropdown-menu button.contextual-menu-item', {
          hasText: 'View as Markdown',
        })
        await viewButton.waitFor({ state: 'visible' })

        const [popup] = await Promise.all([page.waitForEvent('popup'), viewButton.click()])

        try {
          await popup.waitForLoadState('domcontentloaded')

          const contentType = await popup.evaluate(() => document.contentType)
          expect.soft(contentType).toBe('text/markdown')

          const popupContent = await popup.evaluate(() => document.body?.textContent ?? '')
          expect.soft(popupContent).toContain(`# ${pageTitle}`)
        } finally {
          await popup.close()
        }

        return true
      })

      if (success) {
        validated += 1
      }
    }

    expect(validated).toBe(DOC_SAMPLE_SIZE)
  })
})
