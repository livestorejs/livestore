import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const usage = `Usage:
  bun scripts/src/commands/changesets.ts check-pr [--base <ref>]
  bun scripts/src/commands/changesets.ts sync-version-source
  bun scripts/src/commands/changesets.ts write-release-plan [--npm-tag <tag>]
  bun scripts/src/commands/changesets.ts assert-fixed-versions
  bun scripts/src/commands/changesets.ts verify-baseline-changelog
`

const parseArgs = (argv: ReadonlyArray<string>) => {
  const [command = 'help', ...rest] = argv
  const flags = new Map<string, string | true>()

  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index]!
    if (arg.startsWith('--') === false) throw new Error(`Unexpected positional argument: ${arg}`)
    const name = arg.slice(2)
    const next = rest[index + 1]
    if (next !== undefined && next.startsWith('--') === false) {
      flags.set(name, next)
      index++
    } else {
      flags.set(name, true)
    }
  }

  return { command, flags }
}

const readFlag = (flags: Map<string, string | true>, name: string): string | undefined => {
  const value = flags.get(name)
  if (value === true) throw new Error(`--${name} requires a value`)
  return value
}

const runCapture = (command: ReadonlyArray<string>) => {
  const result = spawnSync(command[0]!, command.slice(1), {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status ?? 'signal'}): ${command.join(' ')}\n${result.stderr}`)
  }
  return result.stdout
}

const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T

const publicLivestorePackages = () =>
  readdirSync('packages/@livestore')
    .flatMap((entry) => {
      const packageJsonPath = `packages/@livestore/${entry}/package.json`
      if (existsSync(packageJsonPath) === false) return []
      const packageJson = readJson<{ name?: string; private?: boolean }>(packageJsonPath)
      if (packageJson.private === true || packageJson.name === undefined) return []
      return [{ name: packageJson.name, dir: `packages/@livestore/${entry}` }]
    })
    .sort((left, right) => left.name.localeCompare(right.name))

const changedFiles = (base: string) => {
  const result = spawnSync('git', ['diff', '--name-only', `${base}...HEAD`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.status === 0) return result.stdout.split('\n').filter((line) => line.length > 0)

  return runCapture(['git', 'diff', '--name-only', `${base}..HEAD`])
    .split('\n')
    .filter((line) => line.length > 0)
}

const isChangesetMarkdown = (file: string) =>
  file.startsWith('.changeset/') && file.endsWith('.md') && path.basename(file) !== 'README.md'

const checkPr = (flags: Map<string, string | true>) => {
  if (process.env.LIVESTORE_CHANGESET_CHECK_ALLOW_MISSING === '1') {
    console.log('Changeset PR check skipped by LIVESTORE_CHANGESET_CHECK_ALLOW_MISSING=1')
    return
  }

  const base = readFlag(flags, 'base') ?? process.env.CHANGESET_BASE_REF ?? 'origin/main'
  const files = changedFiles(base)
  if (files.some(isChangesetMarkdown) === true) {
    console.log('This PR changes a changeset file.')
    return
  }

  throw new Error(
    [
      'This PR does not add or modify a changeset.',
      'Run `pnpm exec changeset` for a release-impacting change.',
      'Run `pnpm exec changeset add --empty` when the package change does not need release notes.',
    ].join('\n'),
  )
}

const readReleaseVersion = () => readJson<{ version: string }>('release/version.json').version

const syncVersionSource = () => {
  const packageVersion = readJson<{ version: string }>('packages/@livestore/livestore/package.json').version
  writeFileSync('release/version.json', `${JSON.stringify({ version: packageVersion }, null, 2)}\n`)
  console.log(`Synced release/version.json to ${packageVersion}`)
}

const writeReleasePlan = (flags: Map<string, string | true>) => {
  const version = readReleaseVersion()
  const npmTag = readFlag(flags, 'npm-tag') ?? process.env.LIVESTORE_NPM_TAG ?? 'latest'
  writeFileSync('release/release-plan.json', `${JSON.stringify({ schemaVersion: 1, version, npmTag }, null, 2)}\n`)
  console.log(`Wrote release/release-plan.json for ${version} (${npmTag})`)
}

const assertFixedVersions = () => {
  const version = readReleaseVersion()
  const mismatches = publicLivestorePackages().flatMap((pkg) => {
    const packageVersion = readJson<{ version: string }>(`${pkg.dir}/package.json`).version
    return packageVersion === version ? [] : [`${pkg.name}: ${packageVersion} != ${version}`]
  })

  if (mismatches.length > 0) throw new Error(`Fixed package version mismatch:\n${mismatches.join('\n')}`)
  console.log(`All public @livestore packages are fixed at ${version}`)
}

const extractUnreleasedChangelog = () => {
  const changelog = readFileSync('CHANGELOG.md', 'utf8')
  const start = changelog.indexOf('## 0.4.0 (Unreleased)')
  const end = changelog.indexOf('\n## 0.3.0', start)
  if (start === -1 || end === -1) throw new Error('Unable to locate 0.4.0 unreleased changelog section')
  return changelog.slice(start, end).trimEnd()
}

const verifyBaselineChangelog = () => {
  const baseline = readFileSync('.changeset/livestore-0-4-0-baseline.md', 'utf8')
  const marker = baseline.indexOf('## 0.4.0 (Unreleased)')
  if (marker === -1) throw new Error('Baseline changeset is missing the 0.4.0 changelog section')
  const mirrored = baseline.slice(marker).trimEnd()
  const changelog = extractUnreleasedChangelog()
  if (mirrored !== changelog) {
    throw new Error('Baseline changeset no longer mirrors CHANGELOG.md 0.4.0 (Unreleased)')
  }
  console.log('Baseline changeset mirrors CHANGELOG.md 0.4.0 (Unreleased)')
}

const main = () => {
  const { command, flags } = parseArgs(process.argv.slice(2))
  if (command === 'help') {
    console.log(usage)
    return
  }
  if (command === 'check-pr') return checkPr(flags)
  if (command === 'sync-version-source') return syncVersionSource()
  if (command === 'write-release-plan') return writeReleasePlan(flags)
  if (command === 'assert-fixed-versions') return assertFixedVersions()
  if (command === 'verify-baseline-changelog') return verifyBaselineChangelog()
  throw new Error(`Unknown command: ${command}\n\n${usage}`)
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
