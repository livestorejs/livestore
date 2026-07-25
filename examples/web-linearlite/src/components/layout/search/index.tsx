import { queryDb } from '@livestore/livestore'

import { filterStateQuery, useFilterState } from '../../../livestore/queries.ts'
import { tables } from '../../../livestore/schema/index.ts'
import { useAppStore } from '../../../livestore/store.ts'
import { filterStateToOrderBy, filterStateToWhere } from '../../../livestore/utils.tsx'
import { Filters } from '../filters/index.tsx'
import { FilteredList } from '../list/filtered-list.tsx'

const filteredIssueIdsQuery = (id: string) =>
  queryDb(
    (get) => {
      const filterState = get(filterStateQuery(id)).value
      return tables.issue
        .select('id')
        .where({ ...filterStateToWhere(filterState), deleted: null })
        .orderBy(filterStateToOrderBy(filterState))
    },
    { label: `List.visibleIssueIds:${id}`, deps: id },
  )

const emptyIssueIds: readonly number[] = []

export const Search = () => {
  const store = useAppStore()
  const filteredIssueIds = store.useQuery(filteredIssueIdsQuery(store.sessionId))
  const [filterState] = useFilterState()

  return (
    <>
      <Filters filteredCount={filterState.query ? filteredIssueIds.length : 0} search />
      <FilteredList filteredIssueIds={filterState.query ? filteredIssueIds : emptyIssueIds} />
    </>
  )
}
