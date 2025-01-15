import { Icon, IconName } from '@/components/icons'
import { statusOptions } from '@/data/status-options'
import { Status } from '@/types/status'
import { CheckIcon } from '@heroicons/react/16/solid'
import React from 'react'
import { useKeyboard } from 'react-aria'
import { Button, Menu, MenuItem, MenuTrigger, Popover } from 'react-aria-components'
import { Shortcut } from './shortcut'

export const StatusMenu = ({
  status,
  onStatusChange,
  showLabel = false,
}: {
  status: Status
  onStatusChange: (status: Status) => void
  showLabel?: boolean
}) => {
  const [isOpen, setIsOpen] = React.useState(false)

  const { keyboardProps } = useKeyboard({
    onKeyDown: (e) => {
      Object.entries(statusOptions).forEach(([statusOption, { shortcut }]) => {
        if (e.key === shortcut) {
          onStatusChange(statusOption as Status)
          setIsOpen(false)
          return
        }
      })
    },
  })

  return (
    <MenuTrigger isOpen={isOpen} onOpenChange={setIsOpen}>
      <Button
        aria-label="Select status"
        className="group h-8 min-w-8 rounded-lg flex gap-1.5 px-2 items-center justify-center hover:bg-gray-100 focus:outline-none focus:bg-gray-100"
      >
        <Icon name={statusOptions[status].icon as IconName} className={`size-3.5 ${statusOptions[status].style}`} />
        {showLabel && <span>{statusOptions[status].name}</span>}
      </Button>
      <Popover
        offset={0}
        className="w-48 ml-1 p-2 bg-white rounded-lg shadow-md border border-gray-200 text-sm leading-none"
      >
        <Menu className="focus:outline-none" {...keyboardProps}>
          {Object.entries(statusOptions).map(([statusOption, { name, icon, style, shortcut }]) => (
            <MenuItem
              key={statusOption}
              onAction={() => onStatusChange(statusOption as Status)}
              className="p-2 rounded-md hover:bg-gray-100 focus:outline-none focus:bg-gray-100 cursor-pointer flex items-center gap-2"
            >
              <Icon name={icon as IconName} className={`size-3.5 ${style}`} />
              <span>{name}</span>
              {statusOption === status && <CheckIcon className="size-4 absolute right-10" />}
              <Shortcut keys={[shortcut]} className="absolute right-3" />
            </MenuItem>
          ))}
        </Menu>
      </Popover>
    </MenuTrigger>
  )
}
