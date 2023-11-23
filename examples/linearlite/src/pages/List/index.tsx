import TopFilter from '../../components/TopFilter'
import IssueList from './IssueList'
// import { useFilterState } from '../../utils/filterState'
import { Issue } from '../../types'

function List({ showSearch = false }) {
  // const [filterState] = useFilterState()
  // const { results } = useLiveQuery(
  //   db.issue.liveMany({
  //     orderBy: { [filterState.orderBy]: filterState.orderDirection },
  //     where: filterStateToWhere(filterState),
  //   })
  // )
  const issues: Issue[] = []

  return (
    <div className="flex flex-col flex-grow">
      <TopFilter issues={issues} showSearch={showSearch} />
      <IssueList issues={issues} />
    </div>
  )
}

export default List
