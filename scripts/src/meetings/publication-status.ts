import { createHash } from 'node:crypto'

import { safeFailureCode } from '@local/shared/contributor-meeting-failure'

export const PUBLICATION_ISSUE_MARKER = '<!-- livestore-contributor-meeting-publishing:v1 -->'
const GITHUB_ACTIONS_BOT_ID = 41898282

export type PublicationRun = {
  repository: string
  runId: string
  attempt: string
  ref: string
  event: string
  enabled: boolean
  validation: string
  publication: string
  failure?: string
}

export const reportPublicationStatus = async (
  run: PublicationRun,
  token: string,
  apiUrl = 'https://api.github.com',
): Promise<void> => {
  if (run.enabled === false || run.ref !== 'refs/heads/main' || run.event === 'pull_request') return
  if (
    /^[\w.-]+\/[\w.-]+$/.test(run.repository) === false ||
    /^\d+$/.test(run.runId) === false ||
    /^\d+$/.test(run.attempt) === false
  )
    throw new Error('Invalid workflow run identity')
  const request = async <Result>(path: string, method = 'GET', body?: unknown): Promise<Result> => {
    const response = await fetch(`${apiUrl}/repos/${run.repository}/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30000),
    })
    if (response.ok === false) throw new Error(`GitHub issue reporting failed: ${method} ${path} (${response.status})`)
    return (await response.json()) as Result
  }
  const issues: PublicationIssue[] = []
  for (let page = 1; ; page++) {
    if (page > 100) throw new Error('Cannot establish unique publication issue within 100 issue pages')
    const batch = await request<PublicationIssue[]>(`issues?state=all&per_page=100&page=${page}`)
    issues.push(
      ...batch.filter(
        (issue) =>
          issue.pull_request === undefined &&
          issue.user?.id === GITHUB_ACTIONS_BOT_ID &&
          issue.body?.includes(PUBLICATION_ISSUE_MARKER) === true,
      ),
    )
    if (batch.length < 100) break
  }
  if (issues.length > 1) throw new Error('Multiple contributor meeting publication issues have the ownership marker')
  const issue = issues[0]
  const succeeded = run.validation === 'success' && run.publication === 'success'
  const runUrl = `https://github.com/${run.repository}/actions/runs/${run.runId}/attempts/${run.attempt}`
  if (succeeded === true) {
    if (issue === undefined || issue.state === 'closed') return
    const recoveryMarker = '<!-- meeting-publication-state:recovered -->'
    if (issue.body?.includes(recoveryMarker) !== true) {
      const body = `${PUBLICATION_ISSUE_MARKER}\n${recoveryMarker}\n\nPublication recovered: [verified successful run](${runUrl}).`
      await request(`issues/${issue.number}`, 'PATCH', { body })
      await request(`issues/${issue.number}/comments`, 'POST', {
        body: `Publication recovered. Website verification and Google reconciliation passed in [this run](${runUrl}).`,
      })
    }
    await request(`issues/${issue.number}`, 'PATCH', { state: 'closed', state_reason: 'completed' })
    return
  }
  const jobName = run.validation === 'success' ? 'publish' : 'validate'
  const result = jobName === 'validate' ? run.validation : run.publication
  const { jobs } = await request<{ jobs: PublicationJob[] }>(
    `actions/runs/${run.runId}/attempts/${run.attempt}/jobs?per_page=100`,
  )
  const job = jobs.find((candidate) => candidate.name === jobName)
  const failedStep = job?.steps.find((step) => step.conclusion === 'failure' || step.conclusion === 'cancelled')?.name
  const code = safeFailureCode(run.failure)
  const failure = `${jobName}: ${failedStep ?? 'job did not complete'} (${result})${code === undefined ? '' : ` [${code}]`}`
  const signature = createHash('sha256').update(failure).digest('hex')
  const stateMarker = `<!-- meeting-publication-state:${signature} -->`
  const body = `${PUBLICATION_ISSUE_MARKER}\n${stateMarker}\n\nContributor meeting publication needs attention.\n\nFailure: **${failure}**.\n\n[Inspect the workflow run](${runUrl}). The website remains the canonical schedule; Google Calendar may be stale. Fix the failing step and rerun the workflow. This issue closes after a verified successful publication.`
  if (issue === undefined) {
    await request('issues', 'POST', { title: 'Contributor meeting publishing needs attention', body })
    return
  }
  if (issue.state === 'open' && issue.body?.includes(stateMarker) === true) return
  await request(`issues/${issue.number}`, 'PATCH', { body, state: 'open' })
  await request(`issues/${issue.number}/comments`, 'POST', {
    body: `${issue.state === 'closed' ? 'Publication failed again' : 'Publication failure changed'}: **${failure}**. [Inspect the workflow run](${runUrl}).`,
  })
}

type PublicationIssue = {
  number: number
  state: 'open' | 'closed'
  body: string | null
  /** Immutable GitHub creator ID; the marker alone is user-controlled. */
  user?: { id: number }
  pull_request?: unknown
}

type PublicationJob = {
  name: string
  steps: { name: string; conclusion: string | null }[]
}
