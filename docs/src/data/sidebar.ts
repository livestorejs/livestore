/**
 * Shared sidebar configuration used by both Starlight and llms.txt generators.
 * This ensures the docs structure is consistent across the website and LLM exports.
 */

/**
 * Represents a single doc page entry (no children).
 */
export type TSidebarLink = {
  readonly _tag: 'link'
  /** Slug path relative to content/docs (e.g. 'getting-started/react-web') */
  readonly slug: string
  /** Optional label override (if not provided, uses the doc's title) */
  readonly label?: string
}

/**
 * A group that auto-generates items from a directory.
 * This is the shorthand form where the group label and autogenerate are combined.
 */
export type TSidebarAutoGroup = {
  readonly _tag: 'autoGroup'
  readonly label: string
  readonly directory: string
  readonly collapsed?: boolean
}

/**
 * A group of items with a label and nested items.
 */
export type TSidebarGroup = {
  readonly _tag: 'group'
  readonly label: string
  readonly items: ReadonlyArray<TSidebarItem>
  /** If true, this group is collapsed by default in the UI */
  readonly collapsed?: boolean
}

export type TSidebarItem = TSidebarLink | TSidebarGroup | TSidebarAutoGroup

/** Helper to create a link item */
export const link = (slug: string, label?: string): TSidebarLink =>
  label !== undefined ? { _tag: 'link', slug, label } : { _tag: 'link', slug }

/**
 * Helper to create a group that auto-generates items from a directory.
 * This is the shorthand for `{ label, autogenerate: { directory } }`.
 */
export const autoGroup = (
  label: string,
  directory: string,
  options?: { readonly collapsed?: boolean },
): TSidebarAutoGroup => {
  const base = { _tag: 'autoGroup' as const, label, directory }
  return options?.collapsed !== undefined ? { ...base, collapsed: options.collapsed } : base
}

/** Helper to create a group with explicit items */
export const group = (
  label: string,
  items: ReadonlyArray<TSidebarItem>,
  options?: { readonly collapsed?: boolean },
): TSidebarGroup => {
  const base = { _tag: 'group' as const, label, items }
  return options?.collapsed !== undefined ? { ...base, collapsed: options.collapsed } : base
}

/**
 * Main docs sidebar structure (non-API docs).
 * This defines the hierarchical order and grouping of documentation pages.
 */
export const docsSidebar: ReadonlyArray<TSidebarItem> = [
  link('index'),
  autoGroup('Getting started', 'getting-started'),
  autoGroup('Tutorial', 'tutorial'),
  autoGroup('Overview', 'overview'),
  group('Building with LiveStore', [
    // Top-level files first (manually ordered)
    link('building-with-livestore/rules-for-ai-agents'),
    link('building-with-livestore/events'),
    link('building-with-livestore/data-modeling'),
    link('building-with-livestore/crud'),
    link('building-with-livestore/store'),
    link('building-with-livestore/complex-ui-state'),
    link('building-with-livestore/reactivity-system'),
    link('building-with-livestore/syncing'),
    link('building-with-livestore/debugging'),
    link('building-with-livestore/devtools'),
    link('building-with-livestore/opentelemetry'),
    link('building-with-livestore/production-checklist'),
    // Then nested directories with explicit labels
    autoGroup('State', 'building-with-livestore/state'),
    autoGroup('Tools', 'building-with-livestore/tools'),
    autoGroup('Examples', 'building-with-livestore/examples'),
  ]),
  autoGroup('Framework integrations', 'framework-integrations'),
  autoGroup('Platform adapters', 'platform-adapters'),
  autoGroup('Sync providers', 'sync-providers'),
  autoGroup('Patterns', 'patterns'),
  autoGroup('Understanding LiveStore', 'understanding-livestore'),
  group('Sustainable open source', [
    link('sustainable-open-source/sponsoring'),
    autoGroup('Contributing', 'sustainable-open-source/contributing'),
  ]),
  autoGroup('Miscellaneous', 'misc'),
  link('changelog', 'Changelog'),
]

/**
 * Converts the sidebar config to Starlight's sidebar format.
 * Used by astro.config.ts.
 */
const toStarlightItem = (item: TSidebarItem): unknown => {
  switch (item._tag) {
    case 'link':
      return item.label ? { label: item.label, link: item.slug } : item.slug
    case 'autoGroup':
      return {
        label: item.label,
        autogenerate: { directory: item.directory },
        ...(item.collapsed !== undefined ? { collapsed: item.collapsed } : {}),
      }
    case 'group':
      return {
        label: item.label,
        items: toStarlightSidebar(item.items),
        ...(item.collapsed !== undefined ? { collapsed: item.collapsed } : {}),
      }
  }
}

export const toStarlightSidebar = (items: ReadonlyArray<TSidebarItem>): ReadonlyArray<unknown> =>
  items.map(toStarlightItem)
