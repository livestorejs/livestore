import { filterStateToWhere } from '@/lib/livestore/utils'
import { queryDb } from '@livestore/livestore'
import { useQuery } from '@livestore/react'
import React from 'react'
import TopFilter from '../../components/TopFilter'
import { filterState$ } from '../../lib/livestore/queries'
import { tables } from '../../lib/livestore/schema'
import IssueBoard from './IssueBoard'

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
