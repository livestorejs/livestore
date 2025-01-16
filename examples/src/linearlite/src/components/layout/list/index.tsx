import { Filters } from '@/components/layout/filters'
import { VirtualRow } from '@/components/layout/list/virtual-row'
import { filterState$ } from '@/lib/livestore/queries'
import { tables } from '@/lib/livestore/schema'
import { filterStateToOrderBy, filterStateToWhere } from '@/lib/livestore/utils'
import { queryDb } from '@livestore/livestore'
import { useQuery } from '@livestore/react'
import React from 'react'
import AutoSizer from 'react-virtualized-auto-sizer'
import { FixedSizeList } from 'react-window'

const filteredIssueIds$ = queryDb(
  (get) =>
    tables.issue.query
      .select('id', { pluck: true })
      .where({ ...filterStateToWhere(get(filterState$)), deleted: null })
      .orderBy(filterStateToOrderBy(get(filterState$))),
  { label: 'List.visibleIssueIds' },
)

export const List = () => {
  const filteredIssueIds = useQuery(filteredIssueIds$).map((id) => id.toString())

  return (
    <>
      <Filters filteredCount={filteredIssueIds.length} />
      <div className="grow">
        <AutoSizer>
          {({ height, width }: { width: number; height: number }) => (
            <FixedSizeList
              height={height}
              itemCount={filteredIssueIds.length}
              itemSize={48}
              itemData={filteredIssueIds}
              overscanCount={10}
              width={width}
            >
              {VirtualRow}
            </FixedSizeList>
          )}
        </AutoSizer>
      </div>
    </>
  )
}
