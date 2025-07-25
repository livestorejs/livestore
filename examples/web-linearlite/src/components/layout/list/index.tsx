import { queryDb } from '@livestore/livestore'
import { useStore } from '@livestore/react'
import { Filters } from '@/components/layout/filters'
import { FilteredList } from '@/components/layout/list/filtered-list'
import { filterState$ } from '@/lib/livestore/queries'
import { tables } from '@/lib/livestore/schema'
import { filterStateToOrderBy, filterStateToWhere } from '@/lib/livestore/utils'

const filteredIssueIds$ = queryDb(
  (get) =>
    tables.issue
      .select('id')
      .where({ ...filterStateToWhere(get(filterState$)), deleted: null })
      .orderBy(filterStateToOrderBy(get(filterState$))),
  { label: 'List.visibleIssueIds' },
)

export const List = () => {
  const { store } = useStore()
  const filteredIssueIds = store.useQuery(filteredIssueIds$)

  return (
    <>
      <Filters filteredCount={filteredIssueIds.length} />
      <FilteredList filteredIssueIds={filteredIssueIds} />
    </>
  )
}
