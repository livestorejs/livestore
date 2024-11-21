import React from 'react'
import TopFilter from '../../components/TopFilter'
import * as ReactWindow from 'react-window'
import { queryDb } from '@livestore/livestore'
import { tables } from '../../livestore/schema'
import { filterStateToOrderBy, filterStateToWhere } from '../../utils/filterState'
import { useQuery, useRow } from '@livestore/react'
import { memo, type CSSProperties } from 'react'
import AutoSizer from 'react-virtualized-auto-sizer'
import IssueRow from './IssueRow'
import { filterState$ } from '../../livestore/queries'

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

const filteredIssueIds$ = queryDb(
  (get) =>
    tables.issue.query
      .select('id', { pluck: true })
      .where(filterStateToWhere(get(filterState$)))
      .orderBy(filterStateToOrderBy(get(filterState$))),
  { label: 'List.visibleIssueIds' },
)

const IssueList: React.FC<{ issueIds: readonly string[] }> = (props) => {
  const { issueIds } = props

  return (
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
}

const VirtualIssueRow = memo(
  ({ data, index, style }: { data: readonly string[]; index: number; style: CSSProperties }) => {
    const [issue] = useRow(tables.issue, data[index]!)

    return <IssueRow key={`issue-${issue.id}`} issue={issue} style={style} />
  },
  ReactWindow.areEqual,
)
