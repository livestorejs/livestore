import type { AstroIntegration } from 'astro'

/*
  Temporary ClipboardItem fallback for the contextual menu "Copy Page" action.
  Upstream package `starlight-contextual-menu` assumes `window.ClipboardItem` exists,
  which breaks browsers that only expose `navigator.clipboard.writeText` (e.g. Firefox/Safari).
  TODO(contextual-menu-fallback): remove this integration once the upstream plugin ships
  feature detection (tracked via https://github.com/corsfix/starlight-contextual-menu/issues/13
  and https://github.com/corsfix/starlight-contextual-menu/pull/14).
*/
const copyPageClipboardFallbackScript = String.raw`
(() => {
  const fetchMarkdown = async () => {
    const baseUrl = window.location.href.replace(/\/?$/, '/')
    const markdownUrl = new URL('index.md', baseUrl).toString()

    const response = await fetch(markdownUrl)
    if (!response.ok) {
      throw new Error('Copy Page fallback received ' + response.status + ' for ' + response.url)
    }

    return response.text()
  }

  const setTemporaryLabel = (button, text, originalHtml) => {
    const label = button.querySelector('span')
    if (label) {
      label.textContent = text
    } else {
      button.textContent = text
    }

    window.setTimeout(() => {
      button.innerHTML = originalHtml
    }, 2000)
  }

  const installFallback = () => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return
    if (typeof window.ClipboardItem !== 'undefined') return

    const buttons = Array.from(document.querySelectorAll('button.copy-action'))
    if (buttons.length === 0) return

    buttons.forEach((button) => {
      if (button.dataset.livestoreClipboardFallback === 'true') return

      button.dataset.livestoreClipboardFallback = 'true'

      button.addEventListener(
        'click',
        async (event) => {
          event.preventDefault()
          event.stopImmediatePropagation()

          if (button.dataset.livestoreClipboardInFlight === 'true') return
          button.dataset.livestoreClipboardInFlight = 'true'

          const originalHtml = button.innerHTML

          try {
            const markdown = await fetchMarkdown()

            if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
              throw new Error('navigator.clipboard.writeText is unavailable')
            }

            await navigator.clipboard.writeText(markdown)
            setTemporaryLabel(button, 'Copied!', originalHtml)
          } catch (error) {
            console.error('Copy Page fallback failed:', error)
            setTemporaryLabel(button, 'Copy failed', originalHtml)
          } finally {
            delete button.dataset.livestoreClipboardInFlight
          }
        },
        { capture: true }
      )
    })
  }

  const scheduleFallback = () => {
    installFallback()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleFallback)
  } else {
    scheduleFallback()
  }

  document.addEventListener('astro:page-load', scheduleFallback)
})()
`

export const createCopyPageClipboardFallbackIntegration = (): AstroIntegration => ({
  name: 'livestore-copy-page-clipboard-fallback',
  hooks: {
    'astro:config:setup': ({ injectScript }) => {
      injectScript('page', copyPageClipboardFallbackScript)
    },
  },
})
