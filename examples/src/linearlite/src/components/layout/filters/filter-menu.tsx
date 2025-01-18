import { Icon, IconName } from '@/components/icons'
import { priorityOptions } from '@/data/priority-options'
import { statusOptions } from '@/data/status-options'
import { useFilterState } from '@/lib/livestore/queries'
import { Priority } from '@/types/priority'
import { Status } from '@/types/status'
import { CheckIcon } from '@heroicons/react/16/solid'
import React from 'react'
import { Header, Menu, MenuItem, MenuSection, MenuTrigger, Popover, Separator } from 'react-aria-components'

export const FilterMenu = ({ type, children }: { type?: 'status' | 'priority'; children?: React.ReactNode }) => {
  const [filterState, setFilterState] = useFilterState()

  const toggleFilter = ({ type, value }: { type: 'status'; value: Status } | { type: 'priority'; value: Priority }) => {
    let filters: (Status | Priority)[] | undefined = [...(filterState[type] ?? [])]
    if (filters.includes(value)) filters.splice(filters.indexOf(value), 1)
    else filters.push(value)
    if (!filters.length) filters = undefined
    setFilterState((state) => ({ ...state, [type]: filters }))
  }

  return (
    <MenuTrigger>
      {children}
      <Popover className="w-48 bg-white dark:bg-neutral-800 rounded-lg shadow-md border border-neutral-200 dark:border-neutral-700 text-sm leading-none">
        <Menu className="focus:outline-none" selectionMode="multiple">
          {type !== 'priority' && (
            <MenuSection key="status" className="p-2">
              <Header className="p-2 text-2xs uppercase font-medium tracking-wide text-neutral-400">Status</Header>
              {Object.entries(statusOptions).map(([statusOption, { name, icon, style }]) => {
                const active = filterState.status?.includes(statusOption as Status)
                return (
                  <MenuItem
                    key={statusOption}
                    onAction={() => toggleFilter({ type: 'status', value: statusOption as Status })}
                    className="group/item p-2 pl-9 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-700 focus:outline-none focus:bg-neutral-100 dark:focus:bg-neutral-700 cursor-pointer flex items-center gap-2"
                  >
                    <div
                      className={`absolute left-4 size-4 rounded ${active ? 'bg-indigo-500' : 'hidden group-hover/item:block group-focus/item:block border border-neutral-300 dark:border-neutral-600'}`}
                    >
                      {active && <CheckIcon className="size-4 text-white" />}
                    </div>
                    <Icon name={icon as IconName} className={`size-3.5 ${style}`} />
                    <span>{name}</span>
                  </MenuItem>
                )
              })}
            </MenuSection>
          )}
          {!type && <Separator className="w-full h-px bg-neutral-200 dark:bg-neutral-700" />}
          {type !== 'status' && (
            <MenuSection key="priority" className="p-2">
              <Header className="p-2 text-2xs uppercase font-medium tracking-wide text-neutral-400">Priority</Header>
              {priorityOptions.map(({ name, icon, style }, priorityOption) => {
                const active = filterState.priority?.includes(priorityOption as Priority)
                return (
                  <MenuItem
                    key={priorityOption}
                    onAction={() => toggleFilter({ type: 'priority', value: priorityOption as Priority })}
                    className="group/item p-2 pl-9 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-700 focus:outline-none focus:bg-neutral-100 dark:focus:bg-neutral-700 cursor-pointer flex items-center gap-2"
                  >
                    <div
                      className={`absolute left-4 size-4 rounded ${active ? 'bg-indigo-500' : 'hidden group-hover/item:block group-focus/item:block border border-neutral-300 dark:border-neutral-600'}`}
                    >
                      {active && <CheckIcon className="size-4 text-white" />}
                    </div>
                    <Icon name={icon as IconName} className={`size-3.5 ${style}`} />
                    <span>{name}</span>
                  </MenuItem>
                )
              })}
            </MenuSection>
          )}
        </Menu>
      </Popover>
    </MenuTrigger>
  )
}
