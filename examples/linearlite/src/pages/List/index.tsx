import TopFilter from '../../components/TopFilter'
import IssueList from './IssueList'
import { Issue } from '../../types'
import { querySQL, sql } from '@livestore/livestore'
import { parseFilterStateString } from '../../domain/schema'
import { filterStateToOrder, filterStateToWhere } from '../../utils/filterState'
import { useQuery } from '@livestore/livestore/react'

const filterClause$ = querySQL<{ value: string }>(`select value from filter_state`).pipe((filterStates) => {
  // TODO this handling should be improved (see https://github.com/livestorejs/livestore/issues/22)
  if (filterStates.length === 0) return ''
  const filterStateObj = parseFilterStateString(filterStates[0].value)
  return filterStateToWhere(filterStateObj) + ' ' + filterStateToOrder(filterStateObj)
})
const visibleIssues$ = querySQL<Issue>((get) => sql`select * from issue ${get(filterClause$)}`)

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
