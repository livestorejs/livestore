import { execFileSync } from 'node:child_process'
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { expect, test } from 'vitest'

import { failureCode } from '@local/shared/contributor-meeting-failure'

import { PUBLICATION_ISSUE_MARKER, reportPublicationStatus, safeFailureCode } from './publication-status.ts'
import type { PublicationRun } from './publication-status.ts'

const run: PublicationRun = {
  repository: 'livestorejs/livestore',
  runId: '123',
  attempt: '1',
  ref: 'refs/heads/main',
  event: 'workflow_dispatch',
  enabled: true,
  validation: 'success',
  publication: 'failure',
}

test('reporter loads in an isolated checkout without workspace dependencies', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'meeting-reporter-'))
  try {
    const path = join(directory, 'publication-status.ts')
    await copyFile(new URL('./publication-status.ts', import.meta.url), path)
    execFileSync(
      process.execPath,
      ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(path).href)})`],
      { cwd: directory },
    )
  } finally {
    await rm(directory, { recursive: true })
  }
})

test('one issue follows failures, changed failures, recovery, and recurrence over real HTTP', async () => {
  const issues: { number: number; state: 'open' | 'closed'; body: string; user: { id: number } }[] = []
  const spoofedIssue = { number: 99, state: 'open', body: PUBLICATION_ISSUE_MARKER, user: { id: 123 } }
  const comments: string[] = []
  const writes: string[] = []
  let failedStep = 'Resolve locked browser runtime'
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString())
    const path = request.url ?? ''
    response.setHeader('Content-Type', 'application/json')
    if (request.method === 'GET' && path.includes('/jobs') === true) {
      response.end(
        JSON.stringify({
          jobs: [
            { name: 'publish', steps: [{ name: failedStep, conclusion: 'failure' }] },
            { name: 'validate', steps: [{ name: 'Install locked workspace dependencies', conclusion: 'failure' }] },
          ],
        }),
      )
      return
    }
    if (request.method === 'GET') {
      response.end(JSON.stringify([spoofedIssue, ...issues]))
      return
    }
    writes.push(`${request.method} ${path}`)
    if (request.method === 'POST' && path.endsWith('/issues') === true) {
      issues.push({ number: 7, state: 'open', body: body.body, user: { id: 41898282 } })
    } else if (path.endsWith('/comments') === true) {
      comments.push(body.body)
    } else if (request.method === 'PATCH') {
      Object.assign(issues[0]!, body)
    } else {
      response.statusCode = 404
    }
    response.end('{}')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Missing test server port')
  const apiUrl = `http://127.0.0.1:${address.port}`
  try {
    await reportPublicationStatus({ ...run, publication: 'success' }, 'test-token', apiUrl)
    expect(issues).toHaveLength(0)
    expect(writes).toHaveLength(0)
    await reportPublicationStatus(run, 'test-token', apiUrl)
    expect(issues).toHaveLength(1)
    expect(issues[0]?.body).toContain(PUBLICATION_ISSUE_MARKER)
    expect(issues[0]?.body).toContain('Resolve locked browser runtime')
    expect(comments).toHaveLength(0)
    const createdWrites = writes.length
    await reportPublicationStatus({ ...run, runId: '124' }, 'test-token', apiUrl)
    expect(writes).toHaveLength(createdWrites)
    failedStep = 'Verify canonical production page'
    await reportPublicationStatus(run, 'test-token', apiUrl)
    expect(issues).toHaveLength(1)
    expect(comments).toHaveLength(1)
    expect(comments[0]).toContain('failure changed')
    await reportPublicationStatus({ ...run, publication: 'success' }, 'test-token', apiUrl)
    expect(issues[0]?.state).toBe('closed')
    expect(comments).toHaveLength(2)
    expect(comments[1]).toContain('Publication recovered')
    const recoveredWrites = writes.length
    await reportPublicationStatus({ ...run, publication: 'success' }, 'test-token', apiUrl)
    expect(writes).toHaveLength(recoveredWrites)
    await reportPublicationStatus(run, 'test-token', apiUrl)
    expect(issues).toHaveLength(1)
    expect(issues[0]?.number).toBe(7)
    expect(issues[0]?.state).toBe('open')
    expect(writes.some((path) => path.includes('/issues/99'))).toBe(false)
    expect(comments).toHaveLength(3)
    expect(comments[2]).toContain('failed again')
    await reportPublicationStatus({ ...run, validation: 'failure', publication: 'skipped' }, 'test-token', apiUrl)
    expect(issues[0]?.body).toContain('validate: Install locked workspace dependencies')
    expect(issues[0]?.state).toBe('open')
    expect(comments).toHaveLength(4)
    await reportPublicationStatus({ ...run, publication: 'skipped' }, 'test-token', apiUrl)
    expect(issues[0]?.state).toBe('open')
    await reportPublicationStatus({ ...run, failure: 'page:failed' }, 'test-token', apiUrl)
    const pageFailureComments = comments.length
    await reportPublicationStatus({ ...run, runId: '125', failure: 'page:failed' }, 'test-token', apiUrl)
    expect(comments).toHaveLength(pageFailureComments)
    await reportPublicationStatus({ ...run, failure: 'feed:failed' }, 'test-token', apiUrl)
    expect(comments).toHaveLength(pageFailureComments + 1)
    expect(issues[0]?.body).toContain('feed:failed')
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error === undefined ? resolve() : reject(error))),
    )
  }
})

test('failure fingerprints retain bounded categories without carrying error text or secrets', () => {
  expect(failureCode('authorization', new Error('Google authorization failed (403); secret-key'))).toBe(
    'authorization:http-403',
  )
  expect(failureCode('calendar-apply', new Error('Calendar PATCH failed (429); secret-key'))).toBe(
    'calendar-apply:http-429',
  )
  expect(failureCode('feed', new DOMException('secret-token', 'TimeoutError'))).toBe('feed:timeout')
  expect(failureCode('feed', new Error('secret-token'))).toBe('feed:failed')
  expect(safeFailureCode('authorization:http-403')).toBe('authorization:http-403')
  expect(safeFailureCode('feed:failed\nsecret-token')).toBeUndefined()
  expect(safeFailureCode('secret-token')).toBeUndefined()
})

test('PR, non-main, and disabled runs never contact GitHub', async () => {
  for (const override of [{ enabled: false }, { ref: 'refs/heads/feature' }, { event: 'pull_request' }]) {
    await expect(reportPublicationStatus({ ...run, ...override }, '', 'http://127.0.0.1:1')).resolves.toBeUndefined()
  }
})

test('an unavailable reporting API fails visibly without leaking the token', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(503)
    response.end('do not include the API response in errors')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Missing test server port')
  try {
    await expect(reportPublicationStatus(run, 'secret-token', `http://127.0.0.1:${address.port}`)).rejects.toThrow(
      'GitHub issue reporting failed: GET issues?state=all&per_page=100&page=1 (503)',
    )
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error === undefined ? resolve() : reject(error))),
    )
  }
})
