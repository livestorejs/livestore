/**
 * Client runtime for `<MultiCode />`.
 *
 * Responsibilities:
 *   - Hydrate tab interactions and keep `aria-selected` / focus state in sync.
 *   - Wire the shared copy button (clipboard + fallback) per active panel.
 *   - Surface diagnostics counts + tooltips based on server-provided JSON blobs.
 *   - Observe newly inserted containers (Astro islands/navigation) and initialize them once.
 */
const MULTI_CODE_SELECTOR = '[data-ls-multi-code]'
const TAB_SELECTOR = '[role="tab"]'
const PANEL_SELECTOR = '[role="tabpanel"]'
const READY_FLAG = 'lsMultiCodeReady'
const ACTIVE_KEY = 'active'
const ACTIVE_INDEX_DATASET = 'lsMultiCodeActiveIndex'
const DIAGNOSTICS_SELECTOR = '[data-ls-multi-code-panel-diagnostics]'
const DIAGNOSTICS_OUTLET_SELECTOR = '[data-ls-multi-code-diagnostics]'
const COPY_BUTTON_SELECTOR = '[data-ls-multi-code-copy]'
const COPY_LABEL_SELECTOR = '[data-ls-multi-code-copy-label]'

type Diagnostics = string[]

const isHTMLElement = (value: unknown): value is HTMLElement => value instanceof HTMLElement

// Diagnostics data ships as a JSON blob so the toolbar can render rich hover text.
const parseDiagnostics = (panel: HTMLElement): Diagnostics => {
  const raw = panel.querySelector(DIAGNOSTICS_SELECTOR)
  if (!(raw instanceof HTMLScriptElement)) return []
  try {
    const parsed = JSON.parse(raw.textContent ?? '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// Expressive Code renders gutter + content; stitch everything back together before copying.
const normalizeCodeFromPanel = (panel: HTMLElement): string => {
  if (panel.querySelector('[data-ls-multi-code-error]')) {
    return ''
  }

  const codeLines = panel.querySelectorAll('.ec-line .code')
  if (codeLines.length > 0) {
    return Array.from(codeLines)
      .map((line) => line.textContent ?? '')
      .join('\n')
      .replace(/\u00A0/g, ' ')
  }

  const pre = panel.querySelector('pre')
  if (pre) return (pre.textContent ?? '').replace(/\u00A0/g, ' ')

  const html = panel.querySelector('.ls-multi-code__html')
  return (html?.textContent ?? '').replace(/\u00A0/g, ' ')
}

// Prefer the async Clipboard API but keep an execCommand fallback for older browsers.
const copyTextToClipboard = async (text: string): Promise<boolean> => {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // fall through to fallback copy strategy
    }
  }

  const fallback = document.createElement('textarea')
  fallback.value = text
  fallback.setAttribute('aria-hidden', 'true')
  fallback.style.position = 'fixed'
  fallback.style.top = '0'
  fallback.style.left = '0'
  fallback.style.opacity = '0'
  document.body.appendChild(fallback)
  fallback.select()

  let success = false
  try {
    success = document.execCommand('copy')
  } catch {
    success = false
  }

  document.body.removeChild(fallback)
  return success
}

// Bind tab interactions, copy control, and diagnostics status for a single container.
const initMultiCodeContainer = (container: HTMLElement): void => {
  if (container.dataset[READY_FLAG] === 'true') return
  container.dataset[READY_FLAG] = 'true'

  const tabs = Array.from(container.querySelectorAll<HTMLElement>(TAB_SELECTOR))
  const panels = Array.from(container.querySelectorAll<HTMLElement>(PANEL_SELECTOR))
  if (tabs.length === 0 || panels.length === 0) return

  const diagnosticsOutlet = container.querySelector<HTMLElement>(DIAGNOSTICS_OUTLET_SELECTOR)
  const copyButton = container.querySelector<HTMLButtonElement>(COPY_BUTTON_SELECTOR)
  const copyLabel = copyButton?.querySelector<HTMLElement>(COPY_LABEL_SELECTOR)
  const copyDefault = copyButton?.dataset.copyDefault ?? 'Copy'
  const copySuccess = copyButton?.dataset.copySuccess ?? 'Copied'
  let resetCopyTimeout: number | null = null

  const setCopyState = (state: 'default' | 'success') => {
    if (!copyButton) return
    copyButton.dataset.copyState = state
    if (copyLabel) {
      copyLabel.textContent = state === 'success' ? copySuccess : copyDefault
    }
  }

  const updateDiagnostics = (index: number) => {
    if (!diagnosticsOutlet) return
    const panel = panels[index]
    if (!isHTMLElement(panel)) {
      diagnosticsOutlet.hidden = true
      diagnosticsOutlet.textContent = ''
      diagnosticsOutlet.removeAttribute('title')
      return
    }

    const diagnostics = parseDiagnostics(panel)
    if (diagnostics.length === 0) {
      diagnosticsOutlet.hidden = true
      diagnosticsOutlet.textContent = ''
      diagnosticsOutlet.removeAttribute('title')
      return
    }

    diagnosticsOutlet.hidden = false
    const label = diagnostics.length === 1 ? '1 diagnostic' : `${diagnostics.length} diagnostics`
    diagnosticsOutlet.textContent = label
    diagnosticsOutlet.title = diagnostics.join('\n')
  }

  const setCopyAvailability = (index: number) => {
    if (!copyButton) return
    const panel = panels[index]
    const text = isHTMLElement(panel) ? normalizeCodeFromPanel(panel) : ''
    copyButton.disabled = text.trim().length === 0
  }

  const getActiveIndex = (): number => {
    const current = tabs.findIndex((tab) => tab.dataset[ACTIVE_KEY] != null)
    return current >= 0 ? current : 0
  }

  const setActive = (index: number, focus = false) => {
    tabs.forEach((tab, tabIndex) => {
      const isActive = tabIndex === index
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false')
      tab.tabIndex = isActive ? 0 : -1
      tab.classList.toggle('ls-multi-code__tab--active', isActive)
      if (isActive) {
        tab.dataset[ACTIVE_KEY] = ''
        if (focus && typeof tab.focus === 'function') tab.focus({ preventScroll: true })
      } else {
        delete tab.dataset[ACTIVE_KEY]
      }
    })

    panels.forEach((panel, panelIndex) => {
      const isActive = panelIndex === index
      panel.toggleAttribute('hidden', !isActive)
      panel.classList.toggle('ls-multi-code__panel--active', isActive)
      if (isActive) {
        panel.dataset[ACTIVE_KEY] = ''
      } else {
        delete panel.dataset[ACTIVE_KEY]
      }
    })

    setCopyState('default')
    setCopyAvailability(index)
    updateDiagnostics(index)
    container.dataset[ACTIVE_INDEX_DATASET] = String(index)
  }

  const focusNext = (current: number, delta: number) => {
    const nextIndex = (current + delta + tabs.length) % tabs.length
    setActive(nextIndex, true)
  }

  tabs.forEach((tab, tabIndex) => {
    tab.addEventListener('click', () => setActive(tabIndex))
    tab.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault()
        focusNext(tabIndex, 1)
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault()
        focusNext(tabIndex, -1)
      }
      if (event.key === 'Home') {
        event.preventDefault()
        setActive(0, true)
      }
      if (event.key === 'End') {
        event.preventDefault()
        setActive(tabs.length - 1, true)
      }
    })
  })

  if (copyButton) {
    copyButton.addEventListener('click', async () => {
      const panel = panels[getActiveIndex()]
      if (!isHTMLElement(panel)) return
      const text = normalizeCodeFromPanel(panel)
      if (!text.trim()) return
      const copied = await copyTextToClipboard(text)
      if (!copied) return
      setCopyState('success')
      if (resetCopyTimeout !== null) window.clearTimeout(resetCopyTimeout)
      resetCopyTimeout = window.setTimeout(() => {
        setCopyState('default')
        resetCopyTimeout = null
      }, 1600)
    })
  }

  setActive(getActiveIndex())
}

export const initMultiCode = (container: HTMLElement): void => {
  initMultiCodeContainer(container)
}

// Once on the client, wire up existing containers and watch for future insertions.
const setupObservers = (): void => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return

  const registrySymbol = Symbol.for('livestore.multiCodeObserver')
  const globalRecord = window as typeof window & Record<symbol, boolean | undefined>
  if (globalRecord[registrySymbol] === true) return
  globalRecord[registrySymbol] = true

  const connectExisting = () => {
    document.querySelectorAll<HTMLElement>(MULTI_CODE_SELECTOR).forEach((container) => {
      initMultiCodeContainer(container)
    })
  }

  connectExisting()

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (!isHTMLElement(node)) return
        if (node.matches(MULTI_CODE_SELECTOR)) {
          initMultiCodeContainer(node)
        }
        node.querySelectorAll?.(MULTI_CODE_SELECTOR).forEach((child) => {
          initMultiCodeContainer(child as HTMLElement)
        })
      })
    })
  })

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  })

  window.addEventListener('astro:page-load', connectExisting)
}

setupObservers()
