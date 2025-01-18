import { Filters } from '@/components/layout/filters'
import { FilteredList } from '@/components/layout/list/filtered-list'
import { filterState$ } from '@/lib/livestore/queries'
import { tables } from '@/lib/livestore/schema'
import { filterStateToOrderBy, filterStateToWhere } from '@/lib/livestore/utils'
import { queryDb } from '@livestore/livestore'
import { useQuery } from '@livestore/react'
import React from 'react'

const filteredIssueIds$ = queryDb(
  (get) =>
    tables.issue.query
      .select('id', { pluck: true })
      .where({ ...filterStateToWhere(get(filterState$)), deleted: null })
      .orderBy(filterStateToOrderBy(get(filterState$))),
  { label: 'List.visibleIssueIds' },
)

export const List = () => {
  const filteredIssueIds = useQuery(filteredIssueIds$).map((id) => id)
  console.log(filteredIssueIds)
  return (
    <>
      <Filters filteredCount={filteredIssueIds.length} />
      <FilteredList filteredIssueIds={filteredIssueIds} />
    </>
  )
}
