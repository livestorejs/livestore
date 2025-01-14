import { PriorityOptions } from '@/data/priority-options'
import { Priority } from '@/types/priority'
import { ContextMenuTrigger } from '@firefox-devtools/react-contextmenu'
import React, { ReactNode, useState } from 'react'
import { Portal } from '../Portal'
import { Menu } from './menu'

interface Props {
  id: string
  button: ReactNode
  filterKeyword?: boolean
  className?: string
  onSelect?: (item: Priority) => void
}

function PriorityMenu({ id, button, filterKeyword = false, className, onSelect }: Props) {
  const [keyword, setKeyword] = useState('')

  const handleSelect = (priority: Priority) => {
    setKeyword('')
    if (onSelect) onSelect(priority)
  }
  let statusOpts = Object.entries(PriorityOptions).map(([priority, { Icon, display }]) => ({
    Icon,
    priority: priority as Priority,
    display,
  }))
  if (keyword !== '') {
    const normalizedKeyword = keyword.toLowerCase().trim()
    statusOpts = statusOpts.filter(({ display }) => display.toLowerCase().indexOf(normalizedKeyword) !== -1)
  }

  const options = statusOpts.map(({ Icon, priority, display }, idx) => {
    return (
      <Menu.Item key={`priority-${idx}`} onClick={() => handleSelect(priority)}>
        <Icon className="mr-3" /> <span>{display}</span>
      </Menu.Item>
    )
  })

  return (
    <>
      <ContextMenuTrigger id={id} holdToDisplay={1}>
        {button}
      </ContextMenuTrigger>

      <Portal>
        <Menu
          id={id}
          size="small"
          filterKeyword={filterKeyword}
          searchPlaceholder="Set priority..."
          onKeywordChange={(kw) => setKeyword(kw)}
          className={className}
        >
          {options}
        </Menu>
      </Portal>
    </>
  )
}

export default PriorityMenu
