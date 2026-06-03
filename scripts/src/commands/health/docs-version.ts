/**
 * Health check: verify https://docs.livestore.dev serves the same LiveStore
 * version that npm currently points `latest` at.
 *
 * The docs build emits `<meta name="livestore-version" content="X.Y.Z">`
 * from `docs/astro.config.ts`. This script fetches the landing page, parses
 * that tag, and compares it against `npm view @livestore/livestore version`.
 *
 * Behaviour by trigger:
 *   - `schedule` / `workflow_dispatch`: mismatch opens (or warms) a `bug`
 *     issue.
 *   - `release` (GitHub Release `published`): mismatch is tolerated up to
 *     `--release-grace-min` (default 30) minutes to let the docs deploy
 *     catch up.
 *
 * Run via `bun scripts/src/commands/health/docs-version.ts [--trigger=...] [--release-published-at=ISO]`.
 */

import { spawnSync } from 'node:child_process'

const OWNER = 'livestorejs'
const REPO = 'livestore'
const NPM_PACKAGE = '@livestore/livestore'
const DOCS_URL = 'https://docs.livestore.dev/'
const META_TAG_NAME = 'livestore-version'
const ISSUE_TITLE = 'docs.livestore.dev version drifted from npm latest'
const ISSUE_LABELS = ['bug', 'docs']
const DEFAULT_RELEASE_GRACE_MINUTES = 30

type Trigger = 'schedule' | 'workflow_dispatch' | 'release'

const parseArgs = () => {
  const args = process.argv.slice(2)
  const flags = new Map<string, string>()
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    if (arg.startsWith('--') === false) continue
    const eqIndex = arg.indexOf('=')
    if (eqIndex !== -1) {
      flags.set(arg.slice(2, eqIndex), arg.slice(eqIndex + 1))
      continue
    }
    const next = args[index + 1]
    if (next !== undefined && next.startsWith('--') === false) {
      flags.set(arg.slice(2), next)
      index++
    } else {
      flags.set(arg.slice(2), 'true')
    }
  }
  return flags
}

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

const fetchDocsHtml = async (): Promise<string> => {
  const response = await fetch(DOCS_URL, {
    headers: { accept: 'text/html', 'user-agent': 'livestore-health-docs-version/1.0' },
  })
  if (response.ok === false) {
    throw new Error(`GET ${DOCS_URL} failed: ${response.status} ${response.statusText}`)
  }
  return response.text()
}

const parseDocsVersion = (html: string): string | undefined => {
  // Match either attr order: name first or content first.
  const patterns = [
    new RegExp(`<meta[^>]*name=["']${META_TAG_NAME}["'][^>]*content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*name=["']${META_TAG_NAME}["']`, 'i'),
  ]
  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match !== null) return match[1]
  }
  return undefined
}

const npmLatestVersion = () => runCapture(['npm', 'view', NPM_PACKAGE, 'dist-tags.latest'])

const findOpenIssue = (): { number: number } | undefined => {
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

const openIssue = (body: string): number => {
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
  docsVersion,
  trigger,
}: {
  readonly npmVersion: string
  readonly docsVersion: string | undefined
  readonly trigger: Trigger
}) =>
  [
    `npm \`latest\` for \`${NPM_PACKAGE}\` is \`${npmVersion}\`, but ${DOCS_URL} reports \`${docsVersion ?? '<missing meta tag>'}\`.`,
    '',
    `Trigger: \`${trigger}\`. The expected meta tag is \`<meta name="${META_TAG_NAME}" content="...">\` rendered by \`docs/astro.config.ts\`.`,
    '',
    'Likely causes:',
    '- the docs site was not redeployed after the last npm publish,',
    '- the deploy succeeded but is stuck on an old build, or',
    '- the meta tag was accidentally removed from the Astro config.',
    '',
    'Filed automatically by `.github/workflows/health-docs-version.yml`.',
  ].join('\n')

const main = async () => {
  const flags = parseArgs()
  const trigger = (flags.get('trigger') ?? process.env.GITHUB_EVENT_NAME ?? 'workflow_dispatch') as Trigger
  const releaseGraceMinutes = Number(flags.get('release-grace-min') ?? DEFAULT_RELEASE_GRACE_MINUTES)
  const releasePublishedAtRaw = flags.get('release-published-at')
  const dryRun = flags.get('dry-run') === 'true'

  const npmVersion = npmLatestVersion()
  const html = await fetchDocsHtml()
  const docsVersion = parseDocsVersion(html)

  if (docsVersion === undefined) {
    console.log(`::warning::docs site is missing <meta name="${META_TAG_NAME}"> tag`)
  }

  if (docsVersion === npmVersion) {
    console.log(`::notice::docs version (${docsVersion}) matches npm latest`)
    return
  }

  // Fresh-release grace: a freshly published Release is allowed to lag the docs
  // deploy for up to N minutes before we escalate.
  if (trigger === 'release' && releasePublishedAtRaw !== undefined) {
    const publishedAt = new Date(releasePublishedAtRaw)
    if (Number.isNaN(publishedAt.getTime()) === false) {
      const minutesElapsed = (Date.now() - publishedAt.getTime()) / (1000 * 60)
      if (minutesElapsed < releaseGraceMinutes) {
        console.log(
          `::notice::docs version (${docsVersion ?? 'missing'}) != npm latest (${npmVersion}); within ${releaseGraceMinutes}m release grace (${minutesElapsed.toFixed(1)}m elapsed)`,
        )
        return
      }
    }
  }

  const body = formatBody({ npmVersion, docsVersion, trigger })

  if (dryRun === true) {
    console.log(`::warning::[dry-run] would file docs-version drift issue with title: ${ISSUE_TITLE}`)
    console.log('--- body ---')
    console.log(body)
    return
  }

  const existing = findOpenIssue()
  if (existing === undefined) {
    const issueNumber = openIssue(body)
    console.log(`::warning::Opened docs-version drift issue #${issueNumber}`)
    return
  }

  commentOnIssue(existing.number, `Still mismatched on \`${trigger}\` run.\n\n${body}`)
  console.log(`::warning::Updated docs-version drift issue #${existing.number}`)
}

if (import.meta.main) {
  main().catch((cause) => {
    console.error(cause instanceof Error ? cause.message : String(cause))
    process.exit(1)
  })
}
