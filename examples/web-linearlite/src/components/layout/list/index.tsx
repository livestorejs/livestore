import { queryDb } from '@livestore/livestore'
import { filterState$ } from '../../../livestore/queries.ts'
import { tables } from '../../../livestore/schema/index.ts'
import { useAppStore } from '../../../livestore/store.ts'
import { filterStateToOrderBy, filterStateToWhere } from '../../../livestore/utils.tsx'
import { Filters } from '../filters/index.tsx'
import { FilteredList } from './filtered-list.tsx'

const filteredIssueIds$ = queryDb(
  (get) =>
    tables.issue
      .select('id')
      .where({ ...filterStateToWhere(get(filterState$)), deleted: null })
      .orderBy(filterStateToOrderBy(get(filterState$))),
  { label: 'List.visibleIssueIds' },
)

export const List = () => {
  const store = useAppStore()
  const filteredIssueIds = store.useQuery(filteredIssueIds$)

  return (
    <>
      <Filters filteredCount={filteredIssueIds.length} />
      <FilteredList filteredIssueIds={filteredIssueIds} />
    </>
  )
}
