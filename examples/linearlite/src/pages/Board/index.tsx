import TopFilter from '../../components/TopFilter'
import IssueBoard from './IssueBoard'
// import { useFilterState } from '../../utils/filterState'
import { Issue } from '../../types'

function Board() {
  // const [filterState] = useFilterState()
  // const { db } = useElectric()!
  // const { results } = useLiveQuery(
  //   db.issue.liveMany({
  //     orderBy: {
  //       kanbanorder: 'asc',
  //     },
  //     where: filterStateToWhere(filterState),
  //   })
  // )
  const issues: Issue[] = []

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopFilter title="Board" issues={issues} hideSort={true} />
      <IssueBoard issues={issues} />
    </div>
  )
}

export default Board
