import { queryDb } from '@livestore/livestore'

import { filterStateQuery } from '../../../livestore/queries.ts'
import { tables } from '../../../livestore/schema/index.ts'
import { useAppStore } from '../../../livestore/store.ts'
import { filterStateToOrderBy, filterStateToWhere } from '../../../livestore/utils.tsx'
import { Filters } from '../filters/index.tsx'
import { FilteredList } from './filtered-list.tsx'

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

export const List = () => {
  const store = useAppStore()
  const filteredIssueIds = store.useQuery(filteredIssueIdsQuery(store.sessionId))

  return (
    <>
      <Filters filteredCount={filteredIssueIds.length} />
      <FilteredList filteredIssueIds={filteredIssueIds} />
    </>
  )
}
