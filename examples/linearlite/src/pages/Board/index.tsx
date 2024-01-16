import TopFilter from '../../components/TopFilter'
import IssueBoard from './IssueBoard'
// import { useFilterState } from '../../utils/filterState'
import { Issue } from '../../types'
import { querySQL, sql } from '@livestore/livestore'
import { filterStateToWhere } from '../../utils/filterState'
import { useQuery } from '@livestore/livestore/react'
import { parseFilterStateString } from '../../domain/schema'

const filterClause$ = querySQL<{ value: string }[]>(`select value from filter_state`).pipe((filterStates) => {
  // TODO this handling should be improved (see https://github.com/livestorejs/livestore/issues/22)
  if (filterStates.length === 0) return ''
  const filterStateObj = parseFilterStateString(filterStates[0].value)
  return filterStateToWhere(filterStateObj)
})
const issues$ = querySQL<Issue[]>((get) => sql`SELECT * FROM issue ${get(filterClause$)} ORDER BY kanbanorder ASC`)

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
