import { shouldNeverHappen } from '@livestore/utils'
import { createFileRoute } from '@tanstack/react-router'

import { Issue } from '../components/layout/issue/index.tsx'

export const Route = createFileRoute('/issue')({
  component: IssueRoute,
})

function IssueRoute() {
  const search = Route.useSearch() as Record<string, unknown>
  const issueIdValue = search.issueId

  if (typeof issueIdValue !== 'string' || issueIdValue.length === 0) {
    return shouldNeverHappen('Issue route expected issueId search param')
  }

  const numericId = Number(issueIdValue)

  if (Number.isNaN(numericId)) {
    return shouldNeverHappen('Issue route received invalid issueId param', issueIdValue)
  }

  return <Issue issueId={numericId} />
}
