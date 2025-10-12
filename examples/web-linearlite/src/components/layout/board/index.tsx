import { queryDb } from '@livestore/livestore'
import { useStore } from '@livestore/react'
import { Column } from './column.tsx'
import { Filters } from '../filters/index.tsx'
import { statusOptions } from '../../../data/status-options.ts'
import { filterState$ } from '../../../livestore/queries.ts'
import { tables } from '../../../livestore/schema/index.ts'
import { filterStateToOrderBy, filterStateToWhere } from '../../../livestore/utils.tsx'
import type { Status } from '../../../types/status.ts'

const filteredIssueIds$ = queryDb(
  (get) =>
    tables.issue
      .select('id')
      .where({ ...filterStateToWhere(get(filterState$)), deleted: null })
      .orderBy(filterStateToOrderBy(get(filterState$))),
  { label: 'Board.visibleIssueIds' },
)

export const Board = () => {
  const { store } = useStore()
  const filteredIssueIds = store.useQuery(filteredIssueIds$)

  return (
    <>
      <Filters filteredCount={filteredIssueIds.length} hideStatusFilter hideSorting />
      <div className="grow overflow-x-auto">
        <div className="flex gap-4 p-4 h-full">
          {statusOptions.map((statusDetails, statusOption) => (
            <Column key={statusDetails.id} status={statusOption as Status} statusDetails={statusDetails} />
          ))}
          <div className="w-4 -ml-4 shrink-0" />
        </div>
      </div>
    </>
  )
}
