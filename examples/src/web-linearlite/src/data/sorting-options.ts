export const sortingOptions = {
  priority: { name: 'Priority', shortcut: 'p', defaultDirection: 'desc' },
  status: { name: 'Status', shortcut: 's', defaultDirection: 'asc' },
  created: { name: 'Created', shortcut: 'c', defaultDirection: 'desc' },
  modified: { name: 'Updated', shortcut: 'u', defaultDirection: 'desc' },
}

export type SortingOption = keyof typeof sortingOptions

export type SortingDirection = 'asc' | 'desc'
