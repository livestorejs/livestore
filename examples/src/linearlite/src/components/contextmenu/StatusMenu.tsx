import { StatusOptions } from '@/data/status-options'
import { Status } from '@/types/status'
import { ContextMenuTrigger } from '@firefox-devtools/react-contextmenu'
import React, { ReactNode, useState } from 'react'
import { Portal } from '../Portal'
import { Menu } from './menu'

interface Props {
  id: string
  button: ReactNode
  className?: string
  onSelect?: (item: Status) => void
}
export default function StatusMenu({ id, button, className, onSelect }: Props) {
  const [keyword, setKeyword] = useState('')
  const handleSelect = (status: Status) => {
    if (onSelect) onSelect(status)
  }

  let statuses = Object.entries(StatusOptions).map(([status, { Icon, display }]) => ({
    Icon,
    status: status as Status,
    display,
  }))
  if (keyword !== '') {
    const normalizedKeyword = keyword.toLowerCase().trim()
    statuses = statuses.filter(({ display }) => display.toLowerCase().indexOf(normalizedKeyword) !== -1)
  }

  const options = statuses.map(({ Icon, status, display }) => {
    return (
      <Menu.Item key={`status-${status}`} onClick={() => handleSelect(status)}>
        <Icon className="mr-3" />
        <div className="flex-1 overflow-hidden">{display}</div>
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
          size="normal"
          filterKeyword={true}
          className={className}
          searchPlaceholder="Set status..."
          onKeywordChange={(kw) => setKeyword(kw)}
        >
          {options}
        </Menu>
      </Portal>
    </>
  )
}
