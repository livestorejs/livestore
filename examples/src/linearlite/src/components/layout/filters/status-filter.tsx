import { Icon, IconName } from '@/components/icons'
import { FilterMenu } from '@/components/layout/filters/filter-menu'
import { statusOptions } from '@/data/status-options'
import { useFilterState } from '@/lib/livestore/queries'
import { Status } from '@/types/status'
import { XMarkIcon } from '@heroicons/react/16/solid'
import React from 'react'
import { Button } from 'react-aria-components'

export const StatusFilter = () => {
  const [filterState, setFilterState] = useFilterState()
  if (!filterState.status) return null

  return (
    <div className="text-xs text-neutral-500 dark:text-neutral-400 ml-2 border border-neutral-300 dark:border-neutral-600 rounded-md flex h-6 overflow-hidden shrink-0 whitespace-nowrap">
      <div className="px-2 border-r border-neutral-200 dark:border-neutral-700 h-full flex items-center gap-1">
        <span className="font-medium text-neutral-600 dark:text-neutral-200">Status</span>
        <span>{filterState.status.length > 1 ? 'is any of' : 'is'}</span>
      </div>
      <FilterMenu type="status">
        <Button className="pl-5 pr-2 flex items-center h-full hover:bg-neutral-50 dark:hover:bg-neutral-800 focus:outline-none focus:bg-neutral-100 dark:focus:bg-neutral-800 gap-1.5">
          {filterState.status.map((status, index) => (
            <div key={index} className="h-4 -ml-3 p-px rounded-full bg-white dark:bg-neutral-900">
              <Icon
                name={statusOptions[status as Status].icon as IconName}
                className={`h-full ${statusOptions[status as Status].style}`}
              />
            </div>
          ))}
          {filterState.status.length === 1 ? (
            <span className="font-medium text-neutral-600 dark:text-neutral-200">
              {statusOptions[filterState.status[0] as Status].name}
            </span>
          ) : (
            <span>{filterState.status.length} statuses</span>
          )}
        </Button>
      </FilterMenu>
      <Button
        onPress={() => setFilterState((state) => ({ ...state, status: undefined }))}
        className="h-full flex items-center px-1 group hover:bg-neutral-50 dark:hover:bg-neutral-800 focus:outline-none focus:bg-neutral-100 dark:focus:bg-neutral-800 border-l border-neutral-200 dark:border-neutral-700"
      >
        <XMarkIcon className="size-4 group-hover:text-neutral-700 dark:group-hover:text-neutral-200" />
      </Button>
    </div>
  )
}
