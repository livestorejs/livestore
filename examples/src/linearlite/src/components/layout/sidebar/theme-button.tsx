import { Shortcut } from '@/components/common/shortcut'
import { Theme, themeOptions } from '@/data/theme-options'
import { useFrontendState } from '@/lib/livestore/queries'
import { CheckIcon, MoonIcon, SunIcon } from '@heroicons/react/16/solid'
import { ComputerDesktopIcon } from '@heroicons/react/20/solid'
import React from 'react'
import { useKeyboard } from 'react-aria'
import { Button, Menu, MenuItem, MenuTrigger, Popover } from 'react-aria-components'

export const ThemeButton = () => {
  const [theme, setTheme] = React.useState<Theme | undefined>(undefined)
  const [isOpen, setIsOpen] = React.useState(false)
  const [frontendState, setFrontendState] = useFrontendState()

  const selectTheme = (theme: Theme) => {
    setTheme(theme)
    setFrontendState((state) => ({ ...state, theme }))
    if (theme === 'system') localStorage.removeItem('theme')
    else localStorage.theme = theme
    document.documentElement.classList.toggle(
      'dark',
      localStorage.theme === 'dark' ||
        (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches),
    )
  }

  const { keyboardProps } = useKeyboard({
    onKeyDown: (e) => {
      if (e.key === 'Escape') {
        setIsOpen(false)
        return
      }
      themeOptions.forEach(({ id, shortcut }) => {
        if (e.key === shortcut) {
          selectTheme(id)
          setIsOpen(false)
          return
        }
      })
    },
  })

  React.useEffect(() => {
    if (frontendState.theme) {
      setTheme(frontendState.theme === 'system' ? undefined : frontendState.theme)
    }
  }, [frontendState.theme])

  return (
    <MenuTrigger isOpen={isOpen} onOpenChange={setIsOpen}>
      <Button
        aria-label="Change theme"
        className="size-8 flex items-center justify-center hover:bg-neutral-100 dark:bg-neutral-900 dark:hover:bg-neutral-800 focus:outline-none focus:bg-neutral-100 dark:focus:bg-neutral-800 rounded-lg bg-white border border-neutral-200 dark:border-neutral-700 shadow"
      >
        <SunIcon className="size-4 dark:hidden" />
        <MoonIcon className="size-4 hidden dark:block" />
      </Button>
      <Popover className="bg-white dark:bg-neutral-800 w-40 rounded-lg shadow-md border border-neutral-200 dark:border-neutral-700 text-sm leading-none">
        <Menu className="p-2 focus:outline-none" {...keyboardProps}>
          {themeOptions.map(({ id, label, shortcut }) => {
            return (
              <MenuItem
                key={id}
                onAction={() => selectTheme(id)}
                className="group/item p-2 rounded-md flex items-center gap-2 hover:bg-neutral-100 dark:hover:bg-neutral-700 focus:outline-none focus:bg-neutral-100 dark:focus:bg-neutral-700 cursor-pointer"
              >
                {id === 'light' && <SunIcon className="size-3.5" />}
                {id === 'dark' && <MoonIcon className="size-3.5" />}
                {id === 'system' && <ComputerDesktopIcon className="size-3.5" />}
                <span>{label}</span>
                {id === theme && <CheckIcon className="size-4 absolute right-9" />}
                <Shortcut keys={[shortcut]} className="absolute right-3" />
              </MenuItem>
            )
          })}
        </Menu>
      </Popover>
    </MenuTrigger>
  )
}
