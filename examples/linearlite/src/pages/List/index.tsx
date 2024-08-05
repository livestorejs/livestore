import TopFilter from '../../components/TopFilter'
import IssueList from './IssueList'
import { querySQL, rowQuery, sql } from '@livestore/livestore'
import { tables } from '../../domain/schema'
import { filterStateToOrder, filterStateToWhere } from '../../utils/filterState'
import { getLocalId, useQuery } from '@livestore/livestore/react'
import { Schema } from '@effect/schema'

const filterAndOrderClause$ = rowQuery(tables.filterState, getLocalId(), {
  map: (_) => `${filterStateToWhere(_)} ${filterStateToOrder(_)}`,
  label: 'List.filterAndOrderClause',
})

const visibleIssues$ = querySQL((get) => sql`select * from issue ${get(filterAndOrderClause$)}`, {
  schema: Schema.Array(tables.issue.schema),
  label: 'List.visibleIssues',
})

const List: React.FC<{ showSearch?: boolean }> = ({ showSearch = false }) => {
  const issues = useQuery(visibleIssues$)

  return (
    <div className="flex flex-col flex-grow">
      <TopFilter issues={issues} showSearch={showSearch} />
      <IssueList issues={issues} />
    </div>
  )
}

export default List
