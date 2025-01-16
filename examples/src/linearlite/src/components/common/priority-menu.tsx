import { Icon, IconName } from '@/components/icons'
import { priorityOptions } from '@/data/priority-options'
import { Priority } from '@/types/priority'
import { CheckIcon } from '@heroicons/react/16/solid'
import React from 'react'
import { useKeyboard } from 'react-aria'
import { Button, Menu, MenuItem, MenuTrigger, Popover } from 'react-aria-components'
import { Shortcut } from './shortcut'

export const PriorityMenu = ({
  priority,
  onPriorityChange,
  showLabel = false,
}: {
  priority: Priority
  onPriorityChange: (priority: Priority) => void
  showLabel?: boolean
}) => {
  const [isOpen, setIsOpen] = React.useState(false)

  const { keyboardProps } = useKeyboard({
    onKeyDown: (e) => {
      if (e.key === 'Escape') {
        setIsOpen(false)
        return
      }
      Object.entries(priorityOptions).forEach(([priorityOption, { shortcut }]) => {
        if (e.key === shortcut) {
          onPriorityChange(priorityOption as Priority)
          setIsOpen(false)
          return
        }
      })
    },
  })

  return (
    <MenuTrigger isOpen={isOpen} onOpenChange={setIsOpen}>
      <Button
        aria-label="Select priority"
        className="group h-8 min-w-8 rounded-lg flex gap-1.5 px-2 items-center justify-center hover:bg-gray-100 focus:outline-none focus:bg-gray-100"
      >
        <Icon
          name={priorityOptions[priority].icon as IconName}
          className={`size-3.5 ${priority === 'urgent' ? 'text-red-400 group-hover:text-red-600' : priorityOptions[priority].style}`}
        />
        {showLabel && <span>{priorityOptions[priority].name}</span>}
      </Button>
      <Popover
        offset={0}
        className="w-48 ml-1 p-2 bg-white rounded-lg shadow-md border border-gray-200 text-sm leading-none"
      >
        <Menu className="focus:outline-none" {...keyboardProps}>
          {Object.entries(priorityOptions).map(([priorityOption, { name, icon, style, shortcut }]) => (
            <MenuItem
              key={priorityOption}
              onAction={() => onPriorityChange(priorityOption as Priority)}
              className="p-2 rounded-md hover:bg-gray-100 focus:outline-none focus:bg-gray-100 cursor-pointer flex items-center gap-2"
            >
              <Icon name={icon as IconName} className={`size-3.5 ${style}`} />
              <span>{name}</span>
              {priorityOption === priority && <CheckIcon className="size-4 absolute right-9" />}
              <Shortcut keys={[shortcut]} className="absolute right-3" />
            </MenuItem>
          ))}
        </Menu>
      </Popover>
    </MenuTrigger>
  )
}
