const DEFAULT_REPOSITORY = 'livestorejs/livestore'

/**
 * Remark plugin that converts issue or pull request references (e.g. `#123`)
 * into links pointing to the LiveStore GitHub repository.
 *
 * @param {{ repository?: string }} [options]
 * @returns {(tree: { children?: any[] }) => void}
 */
export function remarkGithubIssueLinks(options = {}) {
  const repository = options.repository ?? DEFAULT_REPOSITORY
  const baseUrl = `https://github.com/${repository}`

  return function transformer(tree) {
    if (!tree || !Array.isArray(tree.children)) {
      return
    }

    transform(tree, [])
  }

  /**
   * @param {{ children?: any[] }} node
   * @param {{ type?: string }[]} ancestors
   */
  function transform(node, ancestors) {
    if (!node || typeof node !== 'object') return

    const children = Array.isArray(node.children) ? node.children : []
    if (children.length === 0) return

    const nextAncestors = [...ancestors, node]

    for (let index = 0; index < children.length; index += 1) {
      const child = children[index]
      if (!child || typeof child !== 'object') continue

      if (child.type === 'text' && typeof child.value === 'string' && !shouldSkip(nextAncestors)) {
        const replacements = createReplacementNodes(child.value)
        if (replacements) {
          children.splice(index, 1, ...replacements)
          index += replacements.length - 1
          continue
        }
      }

      transform(child, nextAncestors)
    }
  }

  /**
   * @param {{ type?: string }[]} ancestors
   */
  function shouldSkip(ancestors) {
    return ancestors.some(
      (ancestor) => ancestor.type === 'link' || ancestor.type === 'linkReference' || ancestor.type === 'definition',
    )
  }

  /**
   * @param {string} value
   * @returns {{ type: string, [key: string]: any }[] | null}
   */
  function createReplacementNodes(value) {
    if (typeof value !== 'string' || value.length === 0) {
      return null
    }

    const nodes = []
    const pattern = /#(\d+)\b/g
    let lastIndex = 0

    for (const match of value.matchAll(pattern)) {
      const matchIndex = match.index ?? 0
      const previousCharacter = matchIndex > 0 ? value[matchIndex - 1] : ''

      if (previousCharacter && /[\p{L}\p{N}#]/u.test(previousCharacter)) {
        continue
      }

      if (matchIndex > lastIndex) {
        nodes.push({ type: 'text', value: value.slice(lastIndex, matchIndex) })
      }

      const reference = match[1]
      nodes.push({
        type: 'link',
        url: `${baseUrl}/issues/${reference}`,
        title: null,
        children: [{ type: 'text', value: `#${reference}` }],
      })

      lastIndex = matchIndex + match[0].length
    }

    if (nodes.length === 0) {
      return null
    }

    if (lastIndex < value.length) {
      nodes.push({ type: 'text', value: value.slice(lastIndex) })
    }

    return nodes
  }
}
