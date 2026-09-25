import { reportPublicationStatus } from './publication-status.ts'

const required = (name: string): string => {
  const value = process.env[name]
  if (value === undefined || value === '') throw new Error(`Missing ${name}`)
  return value
}

if (
  process.env.CONTRIBUTOR_MEETING_PUBLISHING_ENABLED === 'true' &&
  process.env.GITHUB_REF === 'refs/heads/main' &&
  process.env.GITHUB_EVENT_NAME !== 'pull_request'
) {
  await reportPublicationStatus(
    {
      repository: required('GITHUB_REPOSITORY'),
      runId: required('GITHUB_RUN_ID'),
      attempt: required('GITHUB_RUN_ATTEMPT'),
      ref: required('GITHUB_REF'),
      event: required('GITHUB_EVENT_NAME'),
      enabled: true,
      validation: required('MEETING_VALIDATION_RESULT'),
      publication: required('MEETING_PUBLICATION_RESULT'),
    },
    required('GH_TOKEN'),
  )
}
