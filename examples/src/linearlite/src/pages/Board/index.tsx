import React from 'react'
import TopFilter from '../../components/TopFilter'
import IssueBoard from './IssueBoard'
import { queryDb } from '@livestore/livestore'
import { filterStateToWhere } from '../../utils/filterState'
import { useQuery } from '@livestore/react'
import { tables } from '../../livestore/schema'
import { filterState$ } from '../../livestore/queries'

const issues$ = queryDb(
  (get) => tables.issue.query.where(filterStateToWhere(get(filterState$))).orderBy('kanbanorder', 'asc'),
  { label: 'Board.issues' },
)

function Board() {
  const issues = useQuery(issues$)

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopFilter title="Board" filteredIssuesCount={issues.length} hideSort={true} />
      <IssueBoard issues={issues} />
    </div>
  )
}

export default Board
