export const sortingOptions = {
  priority: { name: 'Priority', shortcut: 'P', defaultDirection: 'asc' },
  status: { name: 'Status', shortcut: 'S', defaultDirection: 'asc' },
  created: { name: 'Created', shortcut: 'C', defaultDirection: 'desc' },
  modified: { name: 'Updated', shortcut: 'U', defaultDirection: 'desc' },
}

export type SortingOption = keyof typeof sortingOptions

export type SortingDirection = 'asc' | 'desc'
