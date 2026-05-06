import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import semver from 'semver'

const usage = `Usage:
  bun scripts/src/commands/changesets.ts check-pr [--base <ref>]
  bun scripts/src/commands/changesets.ts restore-prerelease-changesets
  bun scripts/src/commands/changesets.ts sync-version-source
  bun scripts/src/commands/changesets.ts sync-standalone-consumers
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

const runCaptureOptional = (command: ReadonlyArray<string>) => {
  const result = spawnSync(command[0]!, command.slice(1), {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return result.status === 0 ? result.stdout.trim() : undefined
}

const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T

const writeJson = (file: string, value: unknown) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)

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

const isPrereleaseNpmTag = (npmTag: string) => npmTag !== 'latest'

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

const deletedChangesetFiles = () =>
  runCapture(['git', 'diff', '--name-only', '--diff-filter=D', '--', '.changeset'])
    .split('\n')
    .filter((file) => file.length > 0 && isChangesetMarkdown(file) === true)

const restorePrereleaseChangesets = () => {
  const npmTag = process.env.LIVESTORE_NPM_TAG ?? 'latest'
  if (isPrereleaseNpmTag(npmTag) === false) {
    console.log(`Keeping consumed changesets for ${npmTag} release`)
    return
  }

  const restored = deletedChangesetFiles()
  for (const file of restored) {
    writeFileSync(file, runCapture(['git', 'show', `HEAD:${file}`]))
  }

  console.log(`Restored ${restored.length} pending changesets for ${npmTag} prerelease`)
}

type DependencySection = Record<string, string>

type PackageJson = {
  dependencies?: DependencySection
  devDependencies?: DependencySection
  peerDependencies?: DependencySection
  optionalDependencies?: DependencySection
}

const dependencySectionNames = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const satisfies ReadonlyArray<keyof PackageJson>

const packageJsonFiles = () =>
  runCapture(['git', 'ls-files', '*package.json'])
    .split('\n')
    .filter((file) => file.length > 0)

const syncStandaloneConsumers = () => {
  const version = readReleaseVersion()
  const packageNames = new Set(publicLivestorePackages().map((pkg) => pkg.name))
  let changedFileCount = 0
  let changedDependencyCount = 0

  for (const file of packageJsonFiles()) {
    const packageJson = readJson<PackageJson>(file)
    let changed = false

    for (const sectionName of dependencySectionNames) {
      const section = packageJson[sectionName]
      if (section === undefined) continue

      for (const packageName of packageNames) {
        const current = section[packageName]
        if (current === undefined || current.startsWith('workspace:') === true || current === version) continue
        section[packageName] = version
        changed = true
        changedDependencyCount++
      }
    }

    if (changed === true) {
      writeJson(file, packageJson)
      changedFileCount++
    }
  }

  console.log(
    `Synced ${changedDependencyCount} standalone @livestore dependencies in ${changedFileCount} package.json files`,
  )
}

const currentDevDistTag = () => {
  const output = runCaptureOptional(['npm', 'view', '@livestore/common', 'dist-tags.dev', '--json'])
  if (output === undefined || output.length === 0) return undefined
  return JSON.parse(output) as unknown
}

const devPrereleaseVersion = (baseVersion: string) => {
  const parsedBase = semver.parse(baseVersion)
  if (parsedBase === null) throw new Error(`Invalid base version from Changesets: ${baseVersion}`)

  const distTag = currentDevDistTag()
  if (typeof distTag !== 'string') return `${parsedBase.version}-dev.0`

  const parsedDistTag = semver.parse(distTag)
  const prerelease = parsedDistTag?.prerelease ?? []
  const distTagBase =
    parsedDistTag === null ? undefined : `${parsedDistTag.major}.${parsedDistTag.minor}.${parsedDistTag.patch}`

  if (distTagBase !== parsedBase.version || prerelease[0] !== 'dev' || typeof prerelease[1] !== 'number') {
    return `${parsedBase.version}-dev.0`
  }

  return `${parsedBase.version}-dev.${prerelease[1] + 1}`
}

const releaseVersionForNpmTag = (packageVersion: string, npmTag: string) => {
  if (process.env.LIVESTORE_RELEASE_VERSION !== undefined) return process.env.LIVESTORE_RELEASE_VERSION
  if (npmTag === 'dev') return devPrereleaseVersion(packageVersion)
  return packageVersion
}

const syncVersionSource = () => {
  const packageVersion = readJson<{ version: string }>('packages/@livestore/livestore/package.json').version
  const npmTag = process.env.LIVESTORE_NPM_TAG ?? 'latest'
  const version = releaseVersionForNpmTag(packageVersion, npmTag)
  writeJson('release/version.json', { version })
  console.log(`Synced release/version.json to ${version}`)
}

const writeReleasePlan = (flags: Map<string, string | true>) => {
  const version = readReleaseVersion()
  const npmTag = readFlag(flags, 'npm-tag') ?? process.env.LIVESTORE_NPM_TAG ?? 'latest'
  writeJson('release/release-plan.json', { schemaVersion: 1, version, npmTag })
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
  if (command === 'restore-prerelease-changesets') return restorePrereleaseChangesets()
  if (command === 'sync-version-source') return syncVersionSource()
  if (command === 'sync-standalone-consumers') return syncStandaloneConsumers()
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
