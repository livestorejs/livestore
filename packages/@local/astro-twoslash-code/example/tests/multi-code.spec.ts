import { expect, test } from '@playwright/test'

const multiCodeSelector = '[data-ls-multi-code]'

test('renders multi-file snippet and switches tabs', async ({ page }) => {
  await page.goto('/')

  await expect(page.locator(multiCodeSelector)).toHaveCount(2)

  const container = page.locator(`${multiCodeSelector}.ls-demo-primary`).first()
  await expect(container).toBeVisible()

  const tabs = container.locator('[role="tab"]')
  await expect(tabs).toHaveCount(2)

  await tabs.nth(1).click()
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true')

  const panels = container.locator('[role="tabpanel"]')
  await expect(panels.nth(1)).toBeVisible()

  const primaryFrame = container.locator('[role="tabpanel"]').first().locator('.expressive-code > figure').first()
  await expect(primaryFrame.locator('> figcaption.header')).toHaveCount(0)
  expect(await container.locator('.expressive-code > figure.frame').count()).toBeGreaterThan(0)
  await expect(container.locator('[data-ls-multi-code-copy]')).toHaveCount(0)
  expect(await container.locator('.expressive-code .copy button').count()).toBeGreaterThan(0)

  const hoverTarget = container.locator('[role="tabpanel"][data-active] .twoslash-hover').first()
  await hoverTarget.waitFor({ state: 'attached' })
  const popup = container.locator('.twoslash-popup-container').first()

  const globals = await page.evaluate(() => {
    const base = document.querySelector('style[data-ls-twoslash="base"]')?.textContent?.length ?? 0
    const themes = document.querySelector('style[data-ls-twoslash="themes"]')?.textContent?.length ?? 0
    const modules = Array.from(document.querySelectorAll('script[data-ls-twoslash^="module-"]')).map(
      (element) => element.textContent?.length ?? 0,
    )
    return { base, themes, modules }
  })

  expect(globals.base).toBeGreaterThan(1_000)
  expect(globals.themes).toBeGreaterThan(500)
  for (const length of globals.modules) {
    expect(length).toBeGreaterThan(50)
  }

  await hoverTarget.dispatchEvent('mouseenter')

  await page.waitForFunction(() => {
    const element = document.querySelector('.twoslash-popup-container')
    if (!(element instanceof HTMLElement)) {
      return false
    }
    const style = window.getComputedStyle(element)
    const isVisible = style.visibility !== 'hidden' && style.opacity !== '0'
    const hasSize = element.offsetWidth > 0 && element.offsetHeight > 0
    return isVisible && hasSize
  })
  const firstHoverMetrics = await page.evaluate(() => {
    const element = document.querySelector('.twoslash-popup-container')
    if (!(element instanceof HTMLElement)) {
      return null
    }
    const rect = element.getBoundingClientRect()
    return { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
  })
  expect(firstHoverMetrics).not.toBeNull()
  expect(firstHoverMetrics?.width ?? 0).toBeGreaterThan(150)
  expect(firstHoverMetrics?.top ?? 0).toBeGreaterThan(150)

  // Ensure repeat hovers keep working after the initial tooltip activation.
  await hoverTarget.dispatchEvent('mouseleave')
  await expect(popup).toBeHidden()
  await hoverTarget.dispatchEvent('mouseenter')
  await page.waitForFunction(() => {
    const element = document.querySelector('.twoslash-popup-container')
    return element instanceof HTMLElement && element.offsetWidth > 0 && element.offsetHeight > 0
  })
})

test('surfaces TypeScript diagnostics inside the toolbar', async ({ page }) => {
  await page.goto('/')

  const diagnostics = page.locator(`${multiCodeSelector}.ls-demo-diagnostics`).first()
  await expect(diagnostics).toBeVisible()

  await expect(diagnostics.locator('.ls-multi-code__tab-indicator')).toHaveCount(1)

  const statusInfo = await diagnostics.evaluate((container) => {
    const statusElement = container.querySelector('[data-ls-multi-code-diagnostics]')
    if (!(statusElement instanceof HTMLElement)) {
      return { exists: false }
    }
    return {
      exists: true,
      hiddenAttribute: statusElement.hasAttribute('hidden'),
      hiddenProperty: statusElement.hidden,
      text: statusElement.textContent ?? '',
      html: statusElement.outerHTML,
    }
  })

  expect(statusInfo.exists).toBe(true)
  expect(statusInfo.hiddenAttribute).toBe(false)
  expect(statusInfo.hiddenProperty).toBe(false)
  expect(statusInfo.text).toMatch(/diagnostic/)

  const diagnosticMessages = await diagnostics.evaluate((container) => {
    const script = container.querySelector('[data-ls-multi-code-panel-diagnostics]')
    if (!(script instanceof HTMLScriptElement)) {
      return []
    }
    try {
      const parsed = JSON.parse(script.textContent ?? '[]')
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })

  expect(Array.isArray(diagnosticMessages)).toBe(true)
  expect(diagnosticMessages.length).toBeGreaterThan(0)
  expect(String(diagnosticMessages[0])).toContain('Type')
})

test('tooltip stays anchored within the snippet frame on the docs-style route', async ({ page }) => {
  await page.goto('/tooltips')

  const container = page.locator(`${multiCodeSelector}.ls-demo-tooltip`).first()
  await expect(container).toBeVisible()

  const hoverTarget = container.locator('[role="tabpanel"][data-active] .twoslash-hover').first()
  await hoverTarget.waitFor({ state: 'visible' })
  await hoverTarget.scrollIntoViewIfNeeded()
  await hoverTarget.hover()

  const metrics = await page.evaluate(() => {
    const frame = document.querySelector('.ls-demo-tooltip .ls-multi-code__frame')
    const tooltip = document.querySelector('.twoslash-popup-container')
    if (!(frame instanceof HTMLElement) || !(tooltip instanceof HTMLElement)) {
      return null
    }
    const frameRect = frame.getBoundingClientRect()
    const tooltipRect = tooltip.getBoundingClientRect()
    return {
      frame: {
        top: frameRect.top,
        bottom: frameRect.bottom,
      },
      tooltip: {
        top: tooltipRect.top,
        bottom: tooltipRect.bottom,
        width: tooltipRect.width,
        height: tooltipRect.height,
      },
    }
  })

  expect(metrics).not.toBeNull()
  expect(metrics?.tooltip.width ?? 0).toBeGreaterThan(150)
  expect(metrics?.tooltip.height ?? 0).toBeGreaterThan(20)

  // Allow a bit of slack for drop-shadow and arrow offsets introduced by the
  // tooltip styling while it is absolutely positioned against document.body.
  const TOLERANCE_PX = 48
  expect(metrics!.tooltip.top).toBeGreaterThanOrEqual(metrics!.frame.top - TOLERANCE_PX)
  expect(metrics!.tooltip.bottom).toBeLessThanOrEqual(metrics!.frame.bottom + TOLERANCE_PX)
})
