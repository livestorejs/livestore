import { IconName } from '@/components/icons'

import { Icon } from '@/components/icons'
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
    <div className="text-xs text-gray-500 ml-2 border border-gray-300 rounded-md flex h-6 overflow-hidden">
      <div className="px-2 border-r border-gray-200 h-full flex items-center gap-1">
        <span className="font-medium text-gray-600">Status</span>
        <span>{filterState.status.length > 1 ? 'is any of' : 'is'}</span>
      </div>
      <FilterMenu type="status">
        <Button className="pl-5 pr-2 flex items-center h-full hover:bg-gray-50 focus:outline-none focus:bg-gray-100 gap-1.5">
          {filterState.status.map((status, index) => (
            <div className="h-4 -ml-3 p-px rounded-full bg-white">
              <Icon
                name={statusOptions[status as Status].icon as IconName}
                className={`h-full ${statusOptions[status as Status].style}`}
              />
            </div>
          ))}
          {filterState.status.length === 1 ? (
            <span className="font-medium text-gray-600">{statusOptions[filterState.status[0] as Status].name}</span>
          ) : (
            <span>{filterState.status.length} statuses</span>
          )}
        </Button>
      </FilterMenu>
      <Button
        onPress={() => setFilterState((state) => ({ ...state, status: undefined }))}
        className="h-full flex items-center px-1 group hover:bg-gray-50 focus:outline-none focus:bg-gray-100 border-l border-gray-200"
      >
        <XMarkIcon className="size-4 group-hover:text-gray-700" />
      </Button>
    </div>
  )
}
