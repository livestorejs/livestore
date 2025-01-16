import { Icon } from '@/components/icons'
import { FilterMenu } from '@/components/layout/filters/filter-menu'
import { PriorityFilter } from '@/components/layout/filters/priority-filter'
import { SortMenu } from '@/components/layout/filters/sort-menu'
import { StatusFilter } from '@/components/layout/filters/status-filter'
import { SearchBar } from '@/components/search/search-bar'
import { statusOptions } from '@/data/status-options'
import { issueCount$, useFilterState } from '@/lib/livestore/queries'
import { Status } from '@/types/status'
import { useQuery } from '@livestore/react'
import React from 'react'
import { Button } from 'react-aria-components'
import { Header } from './header'

export const Filters = ({
  filteredCount,
  hideStatusFilter,
  hideSorting,
  search,
}: {
  filteredCount: number
  hideStatusFilter?: boolean
  hideSorting?: boolean
  search?: boolean
}) => {
  const totalCount = useQuery(issueCount$)
  const [filterState] = useFilterState()

  return (
    <>
      {search ? (
        <SearchBar />
      ) : (
        <Header
          totalCount={totalCount}
          filteredCount={filteredCount}
          heading={filterState?.status?.length === 1 ? statusOptions[filterState.status[0] as Status].name : 'Issues'}
        />
      )}
      <div className="h-12 border-b border-gray-200 flex items-center justify-between text-sm px-4 gap-8">
        <div className="flex items-center">
          {search && (
            <div className="text-gray-500 text-xs mx-2">
              <span>{filteredCount}</span>
              {filteredCount !== totalCount && <span> of {totalCount}</span>}
              <span> Issues</span>
            </div>
          )}
          <FilterMenu type={hideStatusFilter ? 'priority' : undefined}>
            <Button
              aria-label="Select filters"
              className="group h-6 min-w-6 rounded-lg flex gap-1.5 px-1.5 items-center justify-center hover:bg-gray-100 focus:outline-none focus:bg-gray-100 text-xs font-medium"
            >
              <Icon name="filter" className="size-3.5" />
              {!filterState.status?.length && !filterState.priority?.length && <span>Filter</span>}
            </Button>
          </FilterMenu>
          {!hideStatusFilter && <StatusFilter />}
          <PriorityFilter />
        </div>
        {/* TODO add clear filters/sorting button */}
        {!hideSorting && <SortMenu />}
      </div>
    </>
  )
}
