export type ThemeOption = {
  id: string
  label: string
}

export type Theme = 'light' | 'dark' | 'system'

export const themeOptions: { id: Theme; label: string; shortcut: string }[] = [
  { id: 'light', label: 'Light', shortcut: 'l' },
  { id: 'dark', label: 'Dark', shortcut: 'd' },
  { id: 'system', label: 'System', shortcut: 's' },
]
