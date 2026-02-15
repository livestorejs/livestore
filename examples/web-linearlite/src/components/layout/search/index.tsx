import { queryDb } from '@livestore/livestore'

import { filterState$, useFilterState } from '../../../livestore/queries.ts'
import { tables } from '../../../livestore/schema/index.ts'
import { useAppStore } from '../../../livestore/store.ts'
import { filterStateToOrderBy, filterStateToWhere } from '../../../livestore/utils.tsx'
import { Filters } from '../filters/index.tsx'
import { FilteredList } from '../list/filtered-list.tsx'

const filteredIssueIds$ = queryDb(
  (get) =>
    tables.issue
      .select('id')
      .where({ ...filterStateToWhere(get(filterState$)), deleted: null })
      .orderBy(filterStateToOrderBy(get(filterState$))),
  { label: 'List.visibleIssueIds' },
)

const emptyIssueIds: readonly number[] = []

export const Search = () => {
  const store = useAppStore()
  const filteredIssueIds = store.useQuery(filteredIssueIds$)
  const [filterState] = useFilterState()

  return (
    <>
      <Filters filteredCount={filterState.query ? filteredIssueIds.length : 0} search />
      <FilteredList filteredIssueIds={filterState.query ? filteredIssueIds : emptyIssueIds} />
    </>
  )
}
