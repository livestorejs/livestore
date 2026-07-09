import cp from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

interface RepoRef {
  repo: { owner: string; repo: string }
  ref: string | undefined
}

interface Violation {
  message: string
}

const workspaceRoot = process.env.WORKSPACE_ROOT ?? process.cwd()
const firstPartyOwners = new Set(
  JSON.parse(process.env.FIRST_PARTY_OWNERS_JSON ?? '["overengineeringstudio"]').map((owner: string) =>
    owner.toLowerCase(),
  ),
)
const defaultRef = process.env.DEFAULT_REF ?? 'main'
const verifyReachable = process.env.VERIFY_REACHABLE === '1'
const violations: Violation[] = []

const repoKey = (repo: { owner: string; repo: string }) => `${repo.owner.toLowerCase()}/${repo.repo.toLowerCase()}`
const isFirstParty = (repo: { owner: string; repo: string }) => firstPartyOwners.has(repo.owner.toLowerCase())

const githubRepoFromUrl = (url: string): { owner: string; repo: string } | undefined => {
  const match = url.match(/github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?(?:[#?].*)?$/)
  return match === null ? undefined : { owner: match[1]!, repo: match[2]! }
}

const parseGithubLikeRef = (value: string): RepoRef | undefined => {
  const hashIndex = value.indexOf('#')
  const baseWithQuery = hashIndex >= 0 ? value.slice(0, hashIndex) : value
  const hashRef = hashIndex >= 0 ? value.slice(hashIndex + 1) : undefined
  const queryIndex = baseWithQuery.indexOf('?')
  const base = queryIndex >= 0 ? baseWithQuery.slice(0, queryIndex) : baseWithQuery
  const params = new URLSearchParams(queryIndex >= 0 ? baseWithQuery.slice(queryIndex + 1) : '')
  const queryRef = params.get('ref') ?? undefined

  if (base.startsWith('github:') === true) {
    const parts = base.slice('github:'.length).split('/')
    if (parts.length < 2) return undefined
    return {
      repo: { owner: parts[0]!, repo: parts[1]! },
      ref: hashRef ?? queryRef ?? (parts.length > 2 ? parts.slice(2).join('/') : undefined),
    }
  }

  const urlRepo = githubRepoFromUrl(base)
  if (urlRepo !== undefined) return { repo: urlRepo, ref: hashRef ?? queryRef }

  if (
    value.includes('://') === false &&
    value.startsWith('./') === false &&
    value.startsWith('../') === false &&
    value.startsWith('/') === false
  ) {
    const parts = base.split('/')
    if (parts.length === 2 && parts[0] !== '' && parts[1] !== '') {
      return { repo: { owner: parts[0]!, repo: parts[1]! }, ref: hashRef }
    }
  }

  return undefined
}

const addRefViolation = (file: string, name: string, parsed: RepoRef | undefined) => {
  if (parsed === undefined || parsed.ref === undefined || isFirstParty(parsed.repo) === false) return
  if (parsed.ref === defaultRef || parsed.ref === `refs/heads/${defaultRef}`) return
  violations.push({
    message: `${file}: ${name} ${repoKey(parsed.repo)} uses ref '${parsed.ref}', expected '${defaultRef}'`,
  })
}

const readJson = <T>(file: string): T | undefined => {
  try {
    return JSON.parse(fs.readFileSync(path.join(workspaceRoot, file), 'utf8')) as T
  } catch {
    return undefined
  }
}

const checkMegarepoKdl = () => {
  const file = path.join(workspaceRoot, 'megarepo.kdl')
  if (fs.existsSync(file) === false) return

  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = line.trim().match(/^([A-Za-z0-9_.-]+)\s+"([^"]+)"/)
    if (match === null) continue
    addRefViolation('megarepo.kdl', `member ${match[1]}`, parseGithubLikeRef(match[2]!))
  }
}

const checkMegarepoLock = () => {
  const lock = readJson<{
    members?: Record<string, { url?: string; ref?: string; commit?: string }>
  }>('megarepo.lock')

  for (const [memberName, member] of Object.entries(lock?.members ?? {})) {
    if (typeof member.url !== 'string') continue
    const repo = githubRepoFromUrl(member.url)
    if (repo === undefined || isFirstParty(repo) === false) continue

    addRefViolation('megarepo.lock', `member ${memberName}`, { repo, ref: member.ref })

    if (verifyReachable === true && typeof member.commit === 'string') {
      const remote = `https://github.com/${repo.owner}/${repo.repo}.git`
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'default-ref-policy-'))
      try {
        cp.execFileSync('git', ['-C', tmp, 'init', '-q'], { stdio: 'ignore' })
        cp.execFileSync('git', ['-C', tmp, 'remote', 'add', 'origin', remote], { stdio: 'ignore' })
        cp.execFileSync(
          'git',
          [
            '-C',
            tmp,
            'fetch',
            '-q',
            '--filter=blob:none',
            'origin',
            `refs/heads/${defaultRef}:refs/remotes/origin/${defaultRef}`,
          ],
          {
            stdio: 'ignore',
          },
        )
        cp.execFileSync('git', ['-C', tmp, 'cat-file', '-e', `${member.commit}^{commit}`], { stdio: 'ignore' })
        cp.execFileSync(
          'git',
          ['-C', tmp, 'merge-base', '--is-ancestor', member.commit, `refs/remotes/origin/${defaultRef}`],
          {
            stdio: 'ignore',
          },
        )
      } catch {
        violations.push({
          message: `megarepo.lock: member ${memberName} ${repoKey(repo)} locks ${member.commit.slice(0, 12)} outside '${defaultRef}'`,
        })
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
      }
    }
  }
}

checkMegarepoKdl()
checkMegarepoLock()

if (violations.length === 0) {
  console.log('Default ref policy OK')
} else {
  console.error('Default ref policy failed:')
  for (const violation of violations) console.error(`  - ${violation.message}`)
  console.error('')
  console.error(
    'Fix: merge upstream PRs first, retarget first-party inputs back to their default refs, then refresh locks.',
  )
  process.exit(1)
}
