import { queryDb } from '@livestore/livestore'
import { useStore } from '@livestore/react'
import { Filters } from '../filters/index.tsx'
import { FilteredList } from './filtered-list.tsx'
import { filterState$ } from '../../../livestore/queries.ts'
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
