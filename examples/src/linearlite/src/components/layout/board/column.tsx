import { Icon } from '@/components/icons'
import { VirtualCard } from '@/components/layout/board/virtual-card'
import { NewIssueButton } from '@/components/layout/sidebar/new-issue-button'
import { StatusDetails } from '@/data/status-options'
import { filterState$ } from '@/lib/livestore/queries'
import { tables } from '@/lib/livestore/schema'
import { filterStateToWhere } from '@/lib/livestore/utils'
import { Status } from '@/types/status'
import { queryDb } from '@livestore/livestore'
import { useQuery } from '@livestore/react'
import React from 'react'
import AutoSizer from 'react-virtualized-auto-sizer'
import { FixedSizeList } from 'react-window'

export const Column = ({ status, statusDetails }: { status: Status; statusDetails: StatusDetails }) => {
  const filteredIssueIds$ = queryDb(
    (get) =>
      tables.issue.query
        .select('id', { pluck: true })
        .where({ priority: filterStateToWhere(get(filterState$)).priority, status, deleted: null })
        .orderBy('kanbanorder', 'desc'),
    { label: 'Column.visibleIssueIds' },
  )
  const filteredIssueIds = useQuery(filteredIssueIds$).map((id) => id.toString())

  return (
    <div className="bg-gray-50 border border-gray-100 dark:bg-gray-800 dark:border-gray-700/50 rounded-lg w-64 lg:w-80 shrink-0 h-full flex flex-col">
      <div className="flex items-center justify-between p-2 pl-4 gap-4">
        <div className="flex items-center gap-2">
          <Icon name={statusDetails.icon} className={`size-3.5 ${statusDetails.style}`} />
          <h3 className="font-medium text-sm">{statusDetails.name}</h3>
        </div>
        <NewIssueButton status={status} />
      </div>
      <div className="grow">
        <AutoSizer>
          {({ height, width }: { width: number; height: number }) => (
            <FixedSizeList
              height={height}
              itemCount={filteredIssueIds.length}
              itemSize={122}
              itemData={filteredIssueIds}
              overscanCount={10}
              width={width}
            >
              {VirtualCard}
            </FixedSizeList>
          )}
        </AutoSizer>
      </div>
    </div>
  )
}
