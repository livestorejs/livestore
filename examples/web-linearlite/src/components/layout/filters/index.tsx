import { useStore } from '@livestore/react'
import { Button } from 'react-aria-components'
import { statusOptions } from '../../../data/status-options.ts'
import { issueCount$, useFilterState } from '../../../livestore/queries.ts'
import type { Status } from '../../../types/status.ts'
import { Icon } from '../../icons/index.tsx'
import { SearchBar } from '../search/search-bar.tsx'
import { FilterMenu } from './filter-menu.tsx'
import { Header } from './header.tsx'
import { PriorityFilter } from './priority-filter.tsx'
import { SortMenu } from './sort-menu.tsx'
import { StatusFilter } from './status-filter.tsx'

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
  const { store } = useStore()
  const totalCount = store.useQuery(issueCount$)
  const [filterState] = useFilterState()

  return (
    <>
      {search ? (
        <SearchBar />
      ) : (
        <Header
          totalCount={totalCount}
          filteredCount={filteredCount}
          heading={filterState?.status?.length === 1 ? statusOptions[filterState.status[0] as Status]!.name : 'Issues'}
        />
      )}
      <div className="h-12 border-b border-neutral-200 dark:border-neutral-700 flex items-center justify-between text-sm px-4 gap-8">
        <div className="flex items-center">
          {search && (
            <div className="text-neutral-500 dark:text-neutral-400 text-xs mr-2 lg:ml-2">
              <span>{filteredCount}</span>
              {filteredCount !== totalCount && <span> of {totalCount}</span>}
              <span> Issues</span>
            </div>
          )}
          <FilterMenu type={hideStatusFilter ? 'priority' : undefined}>
            <Button
              aria-label="Select filters"
              className="group h-6 min-w-6 rounded-lg flex gap-1.5 px-1.5 items-center justify-center hover:bg-neutral-100 dark:hover:bg-neutral-800 focus:outline-none focus:bg-neutral-100 dark:focus:bg-neutral-800 text-xs font-medium"
            >
              <Icon name="filter" className="size-3.5" />
              <span className={filterState.status?.length || filterState.priority?.length ? 'lg:hidden' : ''}>
                Filter
              </span>
            </Button>
          </FilterMenu>
          <div className="hidden lg:flex items-center">
            {!hideStatusFilter && <StatusFilter />}
            <PriorityFilter />
          </div>
        </div>
        {/* TODO add clear filters/sorting button */}
        {!hideSorting && <SortMenu />}
      </div>
      {filterState.status?.length || filterState.priority?.length ? (
        <div className="lg:hidden h-12 border-b border-neutral-200 dark:border-neutral-700 overflow-x-auto">
          <div className="flex items-center h-full pl-2">
            {!hideStatusFilter && <StatusFilter />}
            <PriorityFilter />
            <div className="w-4 h-full shrink-0" />
          </div>
        </div>
      ) : null}
    </>
  )
}
