import type { AstroMarkdownOptions } from '@astrojs/markdown-remark'
import rehypeMermaid from 'rehype-mermaid'
import remarkCustomHeaderId from 'remark-custom-header-id'

import { rehypeExternalLinks } from '../plugins/rehype/externalLinks.js'
import { remarkGithubIssueLinks } from '../plugins/remark/githubIssueLinks.js'

// Share the same HTML and heading pipeline between Astro pages and raw Markdown.
export const markdownOptions: AstroMarkdownOptions = {
  syntaxHighlight: {
    type: 'shiki',
    excludeLangs: ['mermaid', 'math', 'd2'],
  },
  remarkPlugins: [
    remarkGithubIssueLinks,
    // MD: {#custom-id}; MDX: \{#custom-id\}.
    remarkCustomHeaderId,
  ],
  rehypePlugins: [
    [rehypeMermaid, { strategy: 'img-svg', dark: true }],
    [rehypeExternalLinks, { internalDomains: ['livestore.dev', 'localhost'] }],
  ],
}
