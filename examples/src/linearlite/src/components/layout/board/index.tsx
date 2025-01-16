import { Filters } from '@/components/layout/filters'
import { statusOptions } from '@/data/status-options'
import { filterState$ } from '@/lib/livestore/queries'
import { tables } from '@/lib/livestore/schema'
import { filterStateToOrderBy, filterStateToWhere } from '@/lib/livestore/utils'
import { Status } from '@/types/status'
import { queryDb } from '@livestore/livestore'
import { useQuery } from '@livestore/react'
import React from 'react'
import { Column } from './column'

const filteredIssueIds$ = queryDb(
  (get) =>
    tables.issue.query
      .select('id', { pluck: true })
      .where({ ...filterStateToWhere(get(filterState$)), deleted: null })
      .orderBy(filterStateToOrderBy(get(filterState$))),
  { label: 'Board.visibleIssueIds' },
)

export const Board = () => {
  const filteredIssueIds = useQuery(filteredIssueIds$)

  return (
    <>
      <Filters filteredCount={filteredIssueIds.length} hideStatusFilter hideSorting />
      <div className="grow overflow-x-auto">
        <div className="flex gap-4 p-4 h-full">
          {Object.entries(statusOptions).map(([statusOption, statusDetails]) => (
            <Column key={statusOption} status={statusOption as Status} statusDetails={statusDetails} />
          ))}
          <div className="w-4 -ml-4 shrink-0" />
        </div>
      </div>
    </>
  )
}
