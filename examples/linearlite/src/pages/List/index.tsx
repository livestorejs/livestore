import TopFilter from '../../components/TopFilter'
import IssueList from './IssueList'
import { ParseUtils, querySQL, sql } from '@livestore/livestore'
import { parseFilterStateString, tables } from '../../domain/schema'
import { filterStateToOrder, filterStateToWhere } from '../../utils/filterState'
import { getLocalId, useQuery } from '@livestore/livestore/react'

// TODO make sure row exists before querying
const filterClause$ = querySQL(`select value from filter_state where id = '${getLocalId()}'`, {
  map: ([{ value }]) => {
    if (value === undefined) return ''
    const filterStateObj = parseFilterStateString(value)
    return filterStateToWhere(filterStateObj) + ' ' + filterStateToOrder(filterStateObj)
  },
})
const visibleIssues$ = querySQL((get) => sql`select * from issue ${get(filterClause$)}`, {
  map: ParseUtils.many(tables.issue),
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
