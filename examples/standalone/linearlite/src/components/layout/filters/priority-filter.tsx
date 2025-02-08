import { IconName } from '@/components/icons'

import { Icon } from '@/components/icons'
import { FilterMenu } from '@/components/layout/filters/filter-menu'
import { priorityOptions } from '@/data/priority-options'
import { useFilterState } from '@/lib/livestore/queries'
import { Priority } from '@/types/priority'
import { XMarkIcon } from '@heroicons/react/16/solid'
import React from 'react'
import { Button } from 'react-aria-components'

export const PriorityFilter = () => {
  const [filterState, setFilterState] = useFilterState()
  if (!filterState.priority) return null

  return (
    <div className="text-xs text-neutral-500 ml-2 border border-neutral-300 dark:border-neutral-600 dark:text-neutral-400 rounded-md flex h-6 overflow-hidden shrink-0 whitespace-nowrap">
      <div className="px-2 border-r border-neutral-200 dark:border-neutral-700 h-full flex items-center gap-1">
        <span className="font-medium text-neutral-600 dark:text-neutral-200">Priority</span>
        <span>{filterState.priority.length > 1 ? 'is any of' : 'is'}</span>
      </div>
      <FilterMenu type="priority">
        <Button className="px-2 flex items-center h-full hover:bg-neutral-50 dark:hover:bg-neutral-800 focus:outline-none focus:bg-neutral-100 dark:focus:bg-neutral-800 gap-1.5">
          {filterState.priority.length === 1 ? (
            <>
              <Icon
                name={priorityOptions[filterState.priority[0] as Priority]!.icon as IconName}
                className={`h-3.5 ${priorityOptions[filterState.priority[0] as Priority]!.style}`}
              />
              <span className="font-medium text-neutral-600 dark:text-neutral-200">
                {priorityOptions[filterState.priority[0] as Priority]!.name}
              </span>
            </>
          ) : (
            <span>{filterState.priority.length} priorities</span>
          )}
        </Button>
      </FilterMenu>
      <Button
        onPress={() => setFilterState((state) => ({ ...state, priority: undefined }))}
        className="h-full flex items-center px-1 group hover:bg-neutral-50 dark:hover:bg-neutral-800 focus:outline-none focus:bg-neutral-100 dark:focus:bg-neutral-800 border-l border-neutral-200 dark:border-neutral-700"
      >
        <XMarkIcon className="size-4 group-hover:text-neutral-700 dark:group-hover:text-neutral-200" />
      </Button>
    </div>
  )
}
