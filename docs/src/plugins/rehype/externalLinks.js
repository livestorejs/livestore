/**
 * Rehype plugin that adds external link indicators to links pointing outside the docs.
 *
 * ## What it does
 *
 * 1. Detects external links (URLs starting with http:// or https:// that don't point to internal domains)
 * 2. Adds an inline SVG icon after the link text to indicate it opens externally
 * 3. Adds `target="_blank"` and `rel="noopener noreferrer"` for security
 * 4. Adds CSS classes for styling
 *
 * ## Configuration
 *
 * @param {Object} options - Plugin options
 * @param {string[]} [options.internalDomains] - Domains to treat as internal (no icon added).
 *   Defaults to ['livestore.dev', 'localhost'].
 * @param {boolean} [options.addTargetBlank] - Whether to add target="_blank" to external links.
 *   Defaults to true.
 * @param {boolean} [options.addIcon] - Whether to add the external link icon.
 *   Defaults to true.
 *
 * ## Usage in astro.config.ts
 *
 * ```ts
 * import { rehypeExternalLinks } from './src/plugins/rehype/externalLinks.js'
 *
 * export default defineConfig({
 *   markdown: {
 *     rehypePlugins: [
 *       [rehypeExternalLinks, { internalDomains: ['livestore.dev', 'localhost'] }],
 *     ],
 *   },
 * })
 * ```
 *
 * ## Styling
 *
 * The plugin adds a `.external-link-icon` class to the SVG icon element.
 * Add styles in your CSS:
 *
 * ```css
 * .external-link-icon {
 *   display: inline-block;
 *   width: 0.75em;
 *   height: 0.75em;
 *   margin-left: 0.125em;
 *   vertical-align: baseline;
 * }
 * ```
 *
 * @see https://unifiedjs.com/learn/guide/create-a-rehype-plugin/
 */

import { visit } from 'unist-util-visit'

/** Default domains considered internal (links to these won't get icons) */
const DEFAULT_INTERNAL_DOMAINS = ['livestore.dev', 'localhost']

/**
 * External link icon SVG as an HAST (Hypertext Abstract Syntax Tree) element.
 * Uses currentColor for stroke so it inherits the link's text color.
 *
 * Icon source: Heroicons "arrow-top-right-on-square"
 * @see https://heroicons.com/
 */
const externalLinkIconHast = {
  type: 'element',
  tagName: 'svg',
  properties: {
    className: ['external-link-icon'],
    'aria-hidden': 'true',
    xmlns: 'http://www.w3.org/2000/svg',
    fill: 'none',
    viewBox: '0 0 24 24',
    'stroke-width': '2',
    stroke: 'currentColor',
  },
  children: [
    {
      type: 'element',
      tagName: 'path',
      properties: {
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        d: 'M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25',
      },
      children: [],
    },
  ],
}

/**
 * Checks if a URL is external (not pointing to an internal domain).
 *
 * @param {string} href - The URL to check
 * @param {string[]} internalDomains - List of internal domain patterns
 * @returns {boolean} True if the link is external
 */
const isExternalLink = (href, internalDomains) => {
  if (!href || typeof href !== 'string') return false

  // Only process absolute URLs starting with http(s)
  if (!href.startsWith('http://') && !href.startsWith('https://')) {
    return false
  }

  try {
    const url = new URL(href)
    const hostname = url.hostname.toLowerCase()

    // Check if the hostname matches any internal domain
    // Supports both exact matches and subdomain matches
    return !internalDomains.some((domain) => {
      const normalizedDomain = domain.toLowerCase()
      return hostname === normalizedDomain || hostname.endsWith(`.${normalizedDomain}`)
    })
  } catch {
    // Invalid URL, treat as not external
    return false
  }
}

/**
 * Creates a deep clone of an HAST node to avoid shared references.
 *
 * @param {Object} node - The HAST node to clone
 * @returns {Object} A deep clone of the node
 */
const cloneHastNode = (node) => {
  if (Array.isArray(node)) {
    return node.map(cloneHastNode)
  }
  if (node && typeof node === 'object') {
    const clone = {}
    for (const key of Object.keys(node)) {
      clone[key] = cloneHastNode(node[key])
    }
    return clone
  }
  return node
}

/**
 * Rehype plugin that adds external link indicators.
 *
 * @param {Object} [options={}] - Plugin options
 * @returns {(tree: Object) => void} The transformer function
 */
export const rehypeExternalLinks = (options = {}) => {
  const { internalDomains = DEFAULT_INTERNAL_DOMAINS, addTargetBlank = true, addIcon = true } = options

  return (tree) => {
    visit(tree, 'element', (node) => {
      // Only process anchor elements with href
      if (node.tagName !== 'a') return
      if (!node.properties?.href) return

      const href = node.properties.href

      // Check if this is an external link
      if (!isExternalLink(href, internalDomains)) return

      // Add target="_blank" for external links (security best practice)
      if (addTargetBlank) {
        node.properties.target = '_blank'
        // noopener prevents the new page from accessing window.opener
        // noreferrer additionally prevents the Referer header from being sent
        node.properties.rel = 'noopener noreferrer'
      }

      // Add the external link icon as the last child
      if (addIcon && Array.isArray(node.children)) {
        // Clone the icon to avoid shared references between nodes
        const iconNode = cloneHastNode(externalLinkIconHast)
        node.children.push(iconNode)
      }

      // Add a class for additional CSS targeting if needed
      if (!node.properties.className) {
        node.properties.className = []
      }
      if (Array.isArray(node.properties.className)) {
        node.properties.className.push('external-link')
      }
    })
  }
}

export default rehypeExternalLinks
