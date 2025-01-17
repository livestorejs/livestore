import { MenuContext } from '@/app/contexts'
import { Icon } from '@/components/icons'
import React, { useContext } from 'react'
import { Button } from 'react-aria-components'

export const MenuButton = ({ className }: { className?: string }) => {
  const { setShowMenu } = useContext(MenuContext)!

  return (
    <Button
      aria-label="Show menu"
      onPress={() => setShowMenu(true)}
      className={`size-8 shrink-0 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-800 focus:outline-none focus:bg-gray-100 dark:focus:bg-gray-800 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow ${className}`}
    >
      <Icon name="sidebar" className="size-4" />
    </Button>
  )
}
