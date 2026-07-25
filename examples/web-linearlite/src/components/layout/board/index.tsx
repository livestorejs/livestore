import { queryDb } from '@livestore/livestore'

import { statusOptions } from '../../../data/status-options.ts'
import { filterStateQuery } from '../../../livestore/queries.ts'
import { tables } from '../../../livestore/schema/index.ts'
import { useAppStore } from '../../../livestore/store.ts'
import { filterStateToOrderBy, filterStateToWhere } from '../../../livestore/utils.tsx'
import type { Status } from '../../../types/status.ts'
import { Filters } from '../filters/index.tsx'
import { Column } from './column.tsx'

const filteredIssueIdsQuery = (id: string) =>
  queryDb(
    (get) => {
      const filterState = get(filterStateQuery(id)).value
      return tables.issue
        .select('id')
        .where({ ...filterStateToWhere(filterState), deleted: null })
        .orderBy(filterStateToOrderBy(filterState))
    },
    { label: `Board.visibleIssueIds:${id}`, deps: id },
  )

export const Board = () => {
  const store = useAppStore()
  const filteredIssueIds = store.useQuery(filteredIssueIdsQuery(store.sessionId))

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
