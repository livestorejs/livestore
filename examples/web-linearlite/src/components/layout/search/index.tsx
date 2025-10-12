import { queryDb } from '@livestore/livestore'
import { useStore } from '@livestore/react'
import { Filters } from '../filters/index.tsx'
import { FilteredList } from '../list/filtered-list.tsx'
import { filterState$, useFilterState } from '../../../livestore/queries.ts'
import { tables } from '../../../livestore/schema/index.ts'
import { filterStateToOrderBy, filterStateToWhere } from '../../../livestore/utils.tsx'

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
