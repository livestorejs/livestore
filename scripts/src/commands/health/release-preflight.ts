/**
 * Health check: release-pipeline pre-flight.
 *
 * Exercises every external token, OIDC binding, and DNS path that the real
 * publish job depends on — without ever publishing. Each probe is captured
 * as a {@link Check} so the aggregated report shows exactly which surface
 * regressed.
 *
 * On failure: open (or update) a `bug`-labelled GitHub issue with the full
 * structured failure list.
 * On all-green: emit `::notice::pre-flight all green` and write the result to
 * `--state-file` (if provided) so callers can see when the pipeline was last
 * verified end-to-end.
 *
 * Designed to be reusable from other release-validation workflows: invoke
 * with `--json` to receive the structured report on stdout instead of the
 * human-readable summary.
 *
 * Run via `bun scripts/src/commands/health/release-preflight.ts [--json] [--state-file=path] [--dry-run]`.
 */

import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const OWNER = 'livestorejs'
const REPO = 'livestore'
const NPM_PACKAGE = '@livestore/livestore'
const NETLIFY_PROD_SITE = 'livestore-docs'
const ISSUE_TITLE = 'release pre-flight regressed'
const ISSUE_LABELS = ['bug']

const REQUIRED_SECRETS = [
  'NPM_TOKEN',
  'NETLIFY_AUTH_TOKEN',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
  'MXBAI_API_KEY',
  'MXBAI_VECTOR_STORE_ID',
] as const

const PATH_TOOLS = ['pnpm', 'node', 'bun', 'gh', 'jq'] as const

type CheckStatus = 'ok' | 'fail' | 'skip'
type Check = {
  readonly name: string
  readonly status: CheckStatus
  readonly detail: string
}

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

const runCapture = (command: ReadonlyArray<string>) =>
  spawnSync(command[0]!, command.slice(1), {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

const checkPathTools = (): Check => {
  const missing: string[] = []
  for (const tool of PATH_TOOLS) {
    const result = runCapture(['which', tool])
    if (result.status !== 0) missing.push(tool)
  }
  if (missing.length === 0) {
    return { name: 'PATH sanity', status: 'ok', detail: `present: ${PATH_TOOLS.join(', ')}` }
  }
  return {
    name: 'PATH sanity',
    status: 'fail',
    detail: `missing on PATH: ${missing.join(', ')}`,
  }
}

const checkSecretsList = (): Check => {
  const result = runCapture(['gh', 'secret', 'list', '--repo', `${OWNER}/${REPO}`])
  if (result.status !== 0) {
    return {
      name: 'GitHub secrets present',
      status: 'fail',
      detail: `gh secret list failed: ${result.stderr.trim()}`,
    }
  }
  const present = new Set(
    result.stdout
      .split('\n')
      .map((line) => line.split(/\s+/)[0])
      .filter((name): name is string => name !== undefined && name !== ''),
  )
  const missing = REQUIRED_SECRETS.filter((secret) => present.has(secret) === false)
  if (missing.length === 0) {
    return {
      name: 'GitHub secrets present',
      status: 'ok',
      detail: `all required: ${REQUIRED_SECRETS.join(', ')}`,
    }
  }
  return {
    name: 'GitHub secrets present',
    status: 'fail',
    detail: `missing: ${missing.join(', ')}`,
  }
}

const checkNpmRead = (): Check => {
  const result = runCapture(['npm', 'view', NPM_PACKAGE, 'versions', '--json'])
  if (result.status !== 0) {
    return { name: 'npm registry read', status: 'fail', detail: result.stderr.trim() }
  }
  try {
    const versions = JSON.parse(result.stdout) as unknown
    if (Array.isArray(versions) === false || versions.length === 0) {
      return { name: 'npm registry read', status: 'fail', detail: 'no versions returned' }
    }
    return {
      name: 'npm registry read',
      status: 'ok',
      detail: `${(versions as ReadonlyArray<string>).length} versions visible`,
    }
  } catch (cause) {
    return {
      name: 'npm registry read',
      status: 'fail',
      detail: `unparseable JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
    }
  }
}

const checkOidcConfig = (): Check => {
  // `actions/oidc/customization/sub` only exists when a custom sub-claim has
  // been configured. The default config returns 404, which is fine — what we
  // want to detect is "GitHub API auth broken", not "no custom sub set".
  const result = runCapture(['gh', 'api', `repos/${OWNER}/${REPO}/actions/oidc/customization/sub`, '--include'])
  const firstLine = result.stdout.split('\n', 1)[0] ?? ''
  if (firstLine.includes('200') === true || firstLine.includes('404') === true) {
    return {
      name: 'GitHub OIDC endpoint reachable',
      status: 'ok',
      detail: firstLine.trim(),
    }
  }
  return {
    name: 'GitHub OIDC endpoint reachable',
    status: 'fail',
    detail: `unexpected response: ${firstLine.trim() || result.stderr.trim()}`,
  }
}

const checkHttpReadProbe = async ({
  name,
  url,
  authHeader,
}: {
  readonly name: string
  readonly url: string
  readonly authHeader: string | undefined
}): Promise<Check> => {
  if (authHeader === undefined || authHeader === '') {
    return { name, status: 'skip', detail: 'auth header missing in env' }
  }
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      headers: { authorization: authHeader, 'user-agent': 'livestore-health-preflight/1.0' },
    })
    // 2xx and 3xx are fine. 401/403 mean the token doesn't have read access on
    // this endpoint — treat as fail. 404 (resource gone) is also a fail. Other
    // 5xx codes are upstream outages, surface them.
    if (response.status < 400) {
      return { name, status: 'ok', detail: `HTTP ${response.status}` }
    }
    return { name, status: 'fail', detail: `HTTP ${response.status} ${response.statusText}` }
  } catch (cause) {
    return {
      name,
      status: 'fail',
      detail: `network error: ${cause instanceof Error ? cause.message : String(cause)}`,
    }
  }
}

const formatReport = (checks: ReadonlyArray<Check>) => {
  const okCount = checks.filter((check) => check.status === 'ok').length
  const failCount = checks.filter((check) => check.status === 'fail').length
  const skipCount = checks.filter((check) => check.status === 'skip').length

  const lines = [
    `Pre-flight summary: ${okCount} ok, ${failCount} fail, ${skipCount} skip (of ${checks.length})`,
    '',
    ...checks.map((check) => `- [${check.status.toUpperCase()}] ${check.name}: ${check.detail}`),
  ]
  return { text: lines.join('\n'), failCount }
}

const findOpenIssue = (): { number: number } | undefined => {
  const result = runCapture([
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
  if (result.status !== 0) return undefined
  try {
    const parsed = JSON.parse(result.stdout) as ReadonlyArray<{ number: number; title: string }>
    const hit = parsed.find((issue) => issue.title === ISSUE_TITLE)
    return hit === undefined ? undefined : { number: hit.number }
  } catch {
    return undefined
  }
}

const openIssue = (body: string): number => {
  const labelArgs = ISSUE_LABELS.flatMap((label) => ['--label', label])
  const result = runCapture([
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
  if (result.status !== 0) {
    throw new Error(`gh issue create failed: ${result.stderr.trim()}`)
  }
  const match = result.stdout.match(/\/issues\/(\d+)/)
  if (match === null) throw new Error(`Failed to parse issue URL from: ${result.stdout}`)
  return Number(match[1])
}

const commentOnIssue = (issueNumber: number, body: string) => {
  const result = runCapture([
    'gh',
    'issue',
    'comment',
    String(issueNumber),
    '--repo',
    `${OWNER}/${REPO}`,
    '--body',
    body,
  ])
  if (result.status !== 0) {
    throw new Error(`gh issue comment failed: ${result.stderr.trim()}`)
  }
}

const formatIssueBody = (reportText: string, runUrl: string | undefined) =>
  [
    'Release pre-flight detected one or more failures. Until this is resolved a real publish run is likely to fail too.',
    '',
    '```',
    reportText,
    '```',
    '',
    runUrl !== undefined ? `Run: ${runUrl}` : '',
    'Filed automatically by `.github/workflows/health-release-preflight.yml`.',
  ]
    .filter((line) => line !== '')
    .join('\n')

export const runPreflight = async (): Promise<{
  readonly checks: ReadonlyArray<Check>
  readonly text: string
  readonly failCount: number
}> => {
  const cloudflareAccountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const cloudflareToken = process.env.CLOUDFLARE_API_TOKEN
  const netlifyToken = process.env.NETLIFY_AUTH_TOKEN
  const mxbaiToken = process.env.MXBAI_API_KEY
  const mxbaiVectorStoreId = process.env.MXBAI_VECTOR_STORE_ID

  const checks: Check[] = [checkPathTools(), checkSecretsList(), checkNpmRead(), checkOidcConfig()]

  checks.push(
    await checkHttpReadProbe({
      name: 'Netlify API read probe',
      // `/sites/<slug>` resolves by site slug just like `/sites/<id>`.
      url: `https://api.netlify.com/api/v1/sites/${NETLIFY_PROD_SITE}.netlify.app`,
      authHeader: netlifyToken === undefined ? undefined : `Bearer ${netlifyToken}`,
    }),
    await checkHttpReadProbe({
      name: 'Cloudflare API read probe',
      url:
        cloudflareAccountId === undefined
          ? 'https://api.cloudflare.com/client/v4/user/tokens/verify'
          : `https://api.cloudflare.com/client/v4/accounts/${cloudflareAccountId}`,
      authHeader: cloudflareToken === undefined ? undefined : `Bearer ${cloudflareToken}`,
    }),
    await checkHttpReadProbe({
      name: 'Mixedbread API read probe',
      url:
        mxbaiVectorStoreId === undefined
          ? 'https://api.mixedbread.com/v1/vector_stores'
          : `https://api.mixedbread.com/v1/vector_stores/${mxbaiVectorStoreId}`,
      authHeader: mxbaiToken === undefined ? undefined : `Bearer ${mxbaiToken}`,
    }),
  )

  const { text, failCount } = formatReport(checks)
  return { checks, text, failCount }
}

const main = async () => {
  const flags = parseArgs()
  const wantJson = flags.get('json') === 'true'
  const stateFile = flags.get('state-file')
  const dryRun = flags.get('dry-run') === 'true'

  const { checks, text, failCount } = await runPreflight()

  if (wantJson === true) {
    console.log(JSON.stringify({ checks, failCount }, null, 2))
  } else {
    console.log(text)
  }

  if (failCount === 0) {
    console.log('::notice::pre-flight all green')
    if (stateFile !== undefined) {
      writeFileSync(stateFile, `${JSON.stringify({ lastGreenAt: new Date().toISOString(), checks }, null, 2)}\n`)
    }
    return
  }

  const runUrl =
    process.env.GITHUB_SERVER_URL !== undefined &&
    process.env.GITHUB_REPOSITORY !== undefined &&
    process.env.GITHUB_RUN_ID !== undefined
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : undefined

  const body = formatIssueBody(text, runUrl)

  if (dryRun === true) {
    console.log(`::warning::[dry-run] would file pre-flight issue with title: ${ISSUE_TITLE}`)
    console.log('--- body ---')
    console.log(body)
    process.exit(1)
  }

  const existing = findOpenIssue()
  if (existing === undefined) {
    const issueNumber = openIssue(body)
    console.log(`::error::Pre-flight failed; opened issue #${issueNumber}`)
  } else {
    commentOnIssue(existing.number, `Pre-flight still failing.\n\n${body}`)
    console.log(`::error::Pre-flight failed; updated issue #${existing.number}`)
  }
  process.exit(1)
}

if (import.meta.main) {
  main().catch((cause) => {
    console.error(cause instanceof Error ? cause.message : String(cause))
    process.exit(1)
  })
}
