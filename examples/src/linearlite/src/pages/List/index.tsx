import React from 'react'
import TopFilter from '../../components/TopFilter'
import * as ReactWindow from 'react-window'
import { querySQL, rowQuery, sql, SessionIdSymbol } from '@livestore/livestore'
import { tables } from '../../domain/schema'
import { filterStateToOrder, filterStateToWhere } from '../../utils/filterState'
import { useQuery, useRow } from '@livestore/react'
import { Schema } from 'effect'
import { memo, type CSSProperties } from 'react'
import AutoSizer from 'react-virtualized-auto-sizer'
import IssueRow from './IssueRow'

const filterAndOrderClause$ = rowQuery(tables.filterState, SessionIdSymbol, {
  map: (_) => `${filterStateToWhere(_)} ${filterStateToOrder(_)}`,
  label: 'List.filterAndOrderClause',
})

const ITEM_HEIGHT = 36

export const List: React.FC<{ showSearch?: boolean }> = ({ showSearch = false }) => {
  const filteredIssueIds = useQuery(filteredIssueIds$)

  return (
    <div className="flex flex-col flex-grow">
      <TopFilter filteredIssuesCount={filteredIssueIds.length} showSearch={showSearch} />
      <IssueList issueIds={filteredIssueIds} />
    </div>
  )
}

const filteredIssueIds$ = querySQL((get) => sql`select id from issue ${get(filterAndOrderClause$)}`, {
  schema: Schema.Array(Schema.Struct({ id: Schema.String }).pipe(Schema.pluck('id'))),
  label: 'List.visibleIssueIds',
})

const IssueList: React.FC<{ issueIds: readonly string[] }> = ({ issueIds }) => (
  <div className="grow">
    <AutoSizer>
      {({ height, width }: { width: number; height: number }) => (
        <ReactWindow.FixedSizeList
          height={height}
          itemCount={issueIds.length}
          itemSize={ITEM_HEIGHT}
          itemData={issueIds}
          overscanCount={10}
          width={width}
        >
          {VirtualIssueRow}
        </ReactWindow.FixedSizeList>
      )}
    </AutoSizer>
  </div>
)

const VirtualIssueRow = memo(
  ({ data, index, style }: { data: readonly string[]; index: number; style: CSSProperties }) => {
    const [issue] = useRow(tables.issue, data[index]!)

    return <IssueRow key={`issue-${issue.id}`} issue={issue} style={style} />
  },
  ReactWindow.areEqual,
)
