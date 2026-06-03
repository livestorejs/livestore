/**
 * Health check: detect drift between the npm `latest` dist-tag for
 * `@livestore/livestore` and the `.version` field in `release/version.json`
 * on the default branch.
 *
 * Drift is allowed for up to 48h to absorb the normal gap between cutting a
 * release PR and the publish job completing. Past the grace window the check
 * opens (or warms) a GitHub issue so a human can intervene.
 *
 * Run via `bun scripts/src/commands/health/npm-version-drift.ts`.
 */

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const OWNER = 'livestorejs'
const REPO = 'livestore'
const NPM_PACKAGE = '@livestore/livestore'
const ISSUE_TITLE = 'npm latest tag drifted from release/version.json for >48h'
// Only existing repo labels (CLAUDE.md: "Don't create new labels, but only reuse existing ones").
// The repo lacks structured `type:* area:* origin:*` axes; `bug` is the closest fit.
const ISSUE_LABELS = ['bug']
const GRACE_HOURS = 48

const runCapture = (command: ReadonlyArray<string>): string => {
  const result = spawnSync(command[0]!, command.slice(1), {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status ?? 'signal'}): ${command.join(' ')}\n${result.stderr}`)
  }
  return result.stdout.trim()
}

const runCaptureOptional = (command: ReadonlyArray<string>): string | undefined => {
  const result = spawnSync(command[0]!, command.slice(1), {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return result.status === 0 ? result.stdout.trim() : undefined
}

const npmLatestVersion = () => runCapture(['npm', 'view', NPM_PACKAGE, 'dist-tags.latest'])

const versionFromFile = () => {
  const filePath = path.join(process.cwd(), 'release', 'version.json')
  const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as { version?: unknown }
  if (typeof parsed.version !== 'string') {
    throw new Error(`release/version.json is missing a string .version field`)
  }
  return parsed.version
}

/**
 * Find the publish time of the GitHub Release tag matching the version in
 * release/version.json. We use this as a proxy for "drift first seen": the
 * file changed in `main` at release-PR merge time, so this is the earliest
 * moment the npm publish should have caught up.
 */
const releaseTagPublishedAt = (version: string): Date | undefined => {
  const tag = `v${version}`
  const raw = runCaptureOptional([
    'gh',
    'api',
    `repos/${OWNER}/${REPO}/releases/tags/${tag}`,
    '--jq',
    '.published_at // empty',
  ])
  if (raw === undefined || raw === '') return undefined
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) === true ? undefined : date
}

/**
 * Fallback: the commit time of release/version.json on the default branch.
 * Used when no GitHub Release exists yet (e.g. dev pre-releases).
 */
const versionFileLastCommitAt = (): Date | undefined => {
  const raw = runCaptureOptional(['git', 'log', '-1', '--format=%cI', '--', 'release/version.json'])
  if (raw === undefined || raw === '') return undefined
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) === true ? undefined : date
}

const findOpenDriftIssue = (): { number: number } | undefined => {
  const raw = runCaptureOptional([
    'gh',
    'issue',
    'list',
    '--repo',
    `${OWNER}/${REPO}`,
    '--state',
    'open',
    '--search',
    `${ISSUE_TITLE} in:title`,
    '--json',
    'number,title',
  ])
  if (raw === undefined || raw === '') return undefined
  const parsed = JSON.parse(raw) as ReadonlyArray<{ number: number; title: string }>
  const hit = parsed.find((issue) => issue.title === ISSUE_TITLE)
  return hit === undefined ? undefined : { number: hit.number }
}

const openDriftIssue = (body: string): number => {
  const labelArgs = ISSUE_LABELS.flatMap((label) => ['--label', label])
  const raw = runCapture([
    'gh',
    'issue',
    'create',
    '--repo',
    `${OWNER}/${REPO}`,
    '--title',
    ISSUE_TITLE,
    '--body',
    body,
    ...labelArgs,
  ])
  const match = raw.match(/\/issues\/(\d+)/)
  if (match === null) throw new Error(`Failed to parse issue URL from: ${raw}`)
  return Number(match[1])
}

const commentOnIssue = (issueNumber: number, body: string) => {
  runCapture(['gh', 'issue', 'comment', String(issueNumber), '--repo', `${OWNER}/${REPO}`, '--body', body])
}

const formatBody = ({
  npmVersion,
  fileVersion,
  firstSeen,
  hoursElapsed,
}: {
  readonly npmVersion: string
  readonly fileVersion: string
  readonly firstSeen: Date
  readonly hoursElapsed: number
}) =>
  [
    `npm \`latest\` for \`${NPM_PACKAGE}\` is \`${npmVersion}\` but \`release/version.json\` on \`main\` is \`${fileVersion}\`.`,
    '',
    `Drift first observable at: \`${firstSeen.toISOString()}\` (~${hoursElapsed.toFixed(1)}h ago).`,
    '',
    'Either the publish job did not run, the npm dist-tag update failed, or the version file was advanced without a successful release.',
    '',
    'Filed automatically by `.github/workflows/health-npm-version-drift.yml`.',
  ].join('\n')

const isPrerelease = (version: string) => version.includes('-')

const main = () => {
  const npmVersion = npmLatestVersion()
  const fileVersion = versionFromFile()

  // `latest` only ever points at a stable version. Pre-release file versions
  // (e.g. `0.4.0-dev.26`) are never expected to match `latest`; they ship under
  // a different dist-tag (`dev`, `next`, ...).
  if (isPrerelease(fileVersion) === true) {
    console.log(`::notice::release/version.json is a pre-release (${fileVersion}); skipping latest-tag drift check`)
    return
  }

  if (npmVersion === fileVersion) {
    console.log(`::notice::npm latest (${npmVersion}) matches release/version.json`)
    return
  }

  const firstSeen = releaseTagPublishedAt(fileVersion) ?? versionFileLastCommitAt() ?? new Date()
  const hoursElapsed = (Date.now() - firstSeen.getTime()) / (1000 * 60 * 60)

  const message = `npm-vs-version-json-drift detected (npm=${npmVersion} file=${fileVersion} first-seen=${firstSeen.toISOString()})`

  if (hoursElapsed < GRACE_HOURS) {
    console.log(`::notice::${message} — within ${GRACE_HOURS}h grace window (${hoursElapsed.toFixed(1)}h)`)
    return
  }

  const body = formatBody({ npmVersion, fileVersion, firstSeen, hoursElapsed })
  const existing = findOpenDriftIssue()
  if (existing === undefined) {
    const issueNumber = openDriftIssue(body)
    console.log(`::warning::Opened drift issue #${issueNumber}`)
    return
  }

  commentOnIssue(existing.number, `Drift still present after ${hoursElapsed.toFixed(1)}h.\n\n${body}`)
  console.log(`::warning::Daily warm-up comment on issue #${existing.number}`)
}

if (import.meta.main) {
  try {
    main()
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : String(cause))
    process.exit(1)
  }
}
