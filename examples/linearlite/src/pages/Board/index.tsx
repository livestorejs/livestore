import React from 'react'
import TopFilter from '../../components/TopFilter'
import IssueBoard from './IssueBoard'
import { querySQL, rowQuery, sql } from '@livestore/livestore'
import { filterStateToWhere } from '../../utils/filterState'
import { getLocalId, useQuery } from '@livestore/livestore/react'
import { tables } from '../../domain/schema'
import { Schema } from '@effect/schema'

const filterClause$ = rowQuery(tables.filterState, getLocalId(), {
  map: filterStateToWhere,
  label: 'Board.filterClause',
})

const issues$ = querySQL((get) => sql`SELECT * FROM issue ${get(filterClause$)} ORDER BY kanbanorder ASC`, {
  schema: Schema.Array(tables.issue.schema),
  label: 'Board.issues',
})

function Board() {
  const issues = useQuery(issues$)

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopFilter title="Board" issues={issues} hideSort={true} />
      <IssueBoard issues={issues} />
    </div>
  )
}

export default Board
