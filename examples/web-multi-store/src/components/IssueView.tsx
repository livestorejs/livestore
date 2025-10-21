import { queryDb } from '@livestore/livestore'
import { useStore } from '@livestore/react'
import { issueStoreOptions } from '@/stores/issue'
import { issueEvents, issueTables } from '../stores/issue/schema.ts'

export function IssueView({ issueId }: { issueId: string }) {
  const issueStore = useStore(issueStoreOptions(issueId)) // Will suspend component if the store is not yet loaded
  const [issue] = issueStore.useQuery(queryDb(issueTables.issue.select().limit(1)))

  const handleChangeStatus = (status: 'todo' | 'in-progress' | 'done') => {
    issueStore.commit(
      issueEvents.issueStatusChanged({
        id: issue.id,
        status,
      }),
    )
  }

  return (
    <div className="container">
      <h3>{issue.title}</h3>
      <dl>
        <dt>ID:</dt>
        <dd>{issue.id}</dd>
        <dt>Store ID:</dt>
        <dd>{issueStore.storeId}</dd>
      </dl>
      <p>
        <strong>Status:</strong> {issue.status}
        <br />
        <button type="button" onClick={() => handleChangeStatus('todo')}>
          To Do
        </button>
        <button type="button" onClick={() => handleChangeStatus('in-progress')}>
          In Progress
        </button>
        <button type="button" onClick={() => handleChangeStatus('done')}>
          Done
        </button>
      </p>

      <h4>Child Issues ({issue.childIssueIds.length})</h4>
      <ul>
        {issue.childIssueIds.map((id) => (
          <IssueView key={id} issueId={id} />
        ))}
      </ul>
    </div>
  )
}
