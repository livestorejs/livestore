/**
 * Client runtime for `<MultiCode />`.
 *
 * Responsibilities:
 *   - Hydrate tab interactions and keep `aria-selected` / focus state in sync.
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

// Bind tab interactions and diagnostics status for a single container.
const initMultiCodeContainer = (container: HTMLElement): void => {
  if (container.dataset[READY_FLAG] === 'true') return
  container.dataset[READY_FLAG] = 'true'

  const tabs = Array.from(container.querySelectorAll<HTMLElement>(TAB_SELECTOR))
  const panels = Array.from(container.querySelectorAll<HTMLElement>(PANEL_SELECTOR))
  if (tabs.length === 0 || panels.length === 0) return

  const diagnosticsOutlet = container.querySelector<HTMLElement>(DIAGNOSTICS_OUTLET_SELECTOR)

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
