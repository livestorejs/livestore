import React from 'react'
import { Portal } from '../Portal'
import { ReactNode, useState } from 'react'
import { ContextMenuTrigger } from '@firefox-devtools/react-contextmenu'
import { BsCheck2 } from 'react-icons/bs'
import { Menu } from './menu'
import { PriorityOptions, PriorityType, StatusOptions, StatusType } from '../../types/issue'
import { useFilterState } from '../../domain/queries'

interface Props {
  id: string
  button: ReactNode
  className?: string
}

export const FilterMenu: React.FC<Props> = ({ id, button, className }) => {
  const [keyword, setKeyword] = useState('')
  const [filterState, setFilterState] = useFilterState()

  const priorities = Object.entries(PriorityOptions).map(([priority, { Icon, display }]) => ({
    Icon,
    priority: priority as PriorityType,
    display,
  }))

  const normalizedKeyword = keyword.toLowerCase().trim()
  const filteredPriorities = priorities.filter(({ display }) => display.toLowerCase().indexOf(normalizedKeyword) !== -1)

  let statuses = Object.entries(StatusOptions).map(([status, { Icon, display }]) => ({
    Icon,
    status: status as StatusType,
    display,
  }))
  if (keyword !== '') {
    const normalizedKeyword = keyword.toLowerCase().trim()
    statuses = statuses.filter(({ display }) => display.toLowerCase().indexOf(normalizedKeyword) !== -1)
  }

  const priorityOptions = filteredPriorities.map(({ Icon, priority, display }, idx) => {
    return (
      <Menu.Item key={`priority-${idx}`} onClick={() => handlePrioritySelect(priority)}>
        <Icon className="mr-3" />
        <span>{display}</span>
        {filterState.priority?.includes(priority) && <BsCheck2 className="ml-auto" />}
      </Menu.Item>
    )
  })

  const statusOptions = statuses.map(({ Icon, status, display }, idx) => {
    return (
      <Menu.Item key={`status-${idx}`} onClick={() => handleStatusSelect(status)}>
        <Icon className="mr-3" />
        <span>{display}</span>
        {filterState.status?.includes(status) && <BsCheck2 className="ml-auto" />}
      </Menu.Item>
    )
  })

  const handlePrioritySelect = (priority: PriorityType) => {
    setKeyword('')
    const newPriority = [...(filterState.priority ?? [])]
    if (newPriority.includes(priority)) {
      newPriority.splice(newPriority.indexOf(priority), 1)
    } else {
      newPriority.push(priority)
    }
    setFilterState((_) => ({ ..._, priority: newPriority }))
  }

  const handleStatusSelect = (status: StatusType) => {
    setKeyword('')
    const newStatus = [...(filterState.status || [])]
    if (newStatus.includes(status)) {
      newStatus.splice(newStatus.indexOf(status), 1)
    } else {
      newStatus.push(status)
    }
    setFilterState((_) => ({ ..._, status: newStatus }))
  }

  return (
    <>
      <ContextMenuTrigger id={id} holdToDisplay={1}>
        {button}
      </ContextMenuTrigger>

      <Portal>
        <Menu
          id={id}
          size="normal"
          filterKeyword={false}
          className={className}
          searchPlaceholder="Filter by..."
          onKeywordChange={(kw) => setKeyword(kw)}
        >
          {priorityOptions && <Menu.Header>Priority</Menu.Header>}
          {priorityOptions}
          {priorityOptions && statusOptions && <Menu.Divider />}
          {statusOptions && <Menu.Header>Status</Menu.Header>}
          {statusOptions}
        </Menu>
      </Portal>
    </>
  )
}
