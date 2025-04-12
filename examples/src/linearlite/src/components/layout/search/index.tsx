import { Filters } from '@/components/layout/filters'
import { FilteredList } from '@/components/layout/list/filtered-list'
import { filterState$, useFilterState } from '@/lib/livestore/queries'
import { tables } from '@/lib/livestore/schema'
import { filterStateToOrderBy, filterStateToWhere } from '@/lib/livestore/utils'
import { queryDb } from '@livestore/livestore'
import { useStore } from '@livestore/react'
import React from 'react'

const filteredIssueIds$ = queryDb(
  (get) =>
    tables.issue
      .select('id')
      .where({ ...filterStateToWhere(get(filterState$)), deleted: null })
      .orderBy(filterStateToOrderBy(get(filterState$))),
  { label: 'List.visibleIssueIds' },
)

export const Search = () => {
  const { store } = useStore()
  const filteredIssueIds = store.useQuery(filteredIssueIds$)
  const [filterState] = useFilterState()

  return (
    <>
      <Filters filteredCount={filterState.query ? filteredIssueIds.length : 0} search />
      <FilteredList filteredIssueIds={filterState.query ? filteredIssueIds : []} />
    </>
  )
}
