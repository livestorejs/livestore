import semver from 'semver'

import { shouldNeverHappen } from '@livestore/utils'
import { CurrentWorkingDirectory, cmd, cmdText } from '@livestore/utils-dev/node'
import { Effect, FileSystem, Result, Schedule, Schema } from '@livestore/utils/effect'
import { Cli } from '@livestore/utils/node'

import { appendGithubSummaryMarkdown, formatMarkdownTable } from '../shared/misc.ts'

class PackageJsonParseError extends Schema.TaggedErrorClass<PackageJsonParseError>()('PackageJsonParseError', {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

type TDependencyField = 'dependencies' | 'devDependencies' | 'peerDependencies' | 'optionalDependencies'

type TMutablePackageJson = {
  name?: string
  private?: boolean
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

const ReleasePlan = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  version: Schema.String,
  npmTag: Schema.String,
})

type TReleasePlan = Schema.Schema.Type<typeof ReleasePlan>

type TReleaseTopology = {
  publishablePackages: readonly { name: string; dir: string }[]
}

const toErrorMessage = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

const dependencyFields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const

const isSnapshotVersion = (version: string) => version.includes('-snapshot-')

const validateReleaseVersion = (version: string) =>
  Effect.sync(() => semver.valid(version)).pipe(
    Effect.flatMap((validVersion) =>
      validVersion === null
        ? Effect.fail(new Error(`Invalid npm semver version: ${version}`))
        : version.includes('-snapshot-') === true
          ? Effect.fail(new Error(`Stable release versions must not use snapshot versions: ${version}`))
          : Effect.succeed(validVersion),
    ),
  )

const validateReleasePlan = (plan: TReleasePlan) =>
  validateReleaseVersion(plan.version).pipe(
    Effect.flatMap((validVersion) =>
      Effect.sync(() => {
        const prerelease = semver.prerelease(validVersion)

        if (plan.npmTag === 'snapshot') {
          throw new Error('The npm tag "snapshot" is reserved for CI snapshot publishing')
        }

        if (plan.npmTag === 'latest' && prerelease !== null) {
          throw new Error(`The npm tag "latest" requires a stable version, got ${validVersion}`)
        }

        if (plan.npmTag === 'dev') {
          if (prerelease?.[0] !== 'dev') {
            throw new Error(`The npm tag "dev" requires a dev prerelease version, got ${validVersion}`)
          }
          return validVersion
        }

        if (plan.npmTag !== 'latest' && prerelease === null) {
          throw new Error(`The npm tag "${plan.npmTag}" requires a prerelease version, got ${validVersion}`)
        }

        return validVersion
      }),
    ),
  )

const releasePlanPath = (cwd: string) => `${cwd}/release/release-plan.json`

const releaseNotesPath = (cwd: string) => `${cwd}/release/release-notes.md`

/**
 * Slices a single version's section out of `CHANGELOG.md`.
 *
 * The changelog uses headings shaped like `## <version> - YYYY-MM-DD` (date
 * optional). We match the version token strictly between `## ` and the end of
 * the line (allowing trailing ` - <date>` or whitespace), so `0.4.0` does not
 * accidentally match `0.4.0-dev.23` or vice-versa. The returned block is the
 * verbatim section content excluding the `## <version> ...` heading line and
 * stopping at the next `## ` heading. Trailing blank lines are trimmed; a
 * single trailing newline is normalized.
 *
 * Throws when the heading is not found, or when more than one `## <version>`
 * heading exists (defensive — should never happen, but cheap to guard).
 */
export const sliceChangelogSection = (changelog: string, version: string): string => {
  const lines = changelog.split('\n')
  /**
   * Match `## <version>` where the version is followed by either end-of-line,
   * whitespace, or ` - <anything>`. The strict boundary prevents `0.4.0` from
   * matching `0.4.0-dev.23` and vice-versa.
   */
  const headingIndices: number[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (line.startsWith('## ') === false) continue
    const rest = line.slice(3).trimEnd()
    if (rest === version) {
      headingIndices.push(i)
      continue
    }
    if (rest.startsWith(`${version} `) === true || rest.startsWith(`${version}\t`) === true) {
      headingIndices.push(i)
    }
  }

  if (headingIndices.length === 0) {
    throw new Error(`No changelog section found for version ${version} in CHANGELOG.md`)
  }
  if (headingIndices.length > 1) {
    throw new Error(
      `Multiple changelog sections found for version ${version} in CHANGELOG.md (lines ${headingIndices.map((i) => i + 1).join(', ')})`,
    )
  }

  const startIndex = headingIndices[0]! + 1
  let endIndex = lines.length
  for (let i = startIndex; i < lines.length; i++) {
    if (lines[i]!.startsWith('## ') === true) {
      endIndex = i
      break
    }
  }

  /** Trim leading and trailing blank lines, then normalize to a single trailing newline. */
  let start = startIndex
  while (start < endIndex && lines[start]!.trim() === '') start += 1
  let end = endIndex
  while (end > start && lines[end - 1]!.trim() === '') end -= 1

  return `${lines.slice(start, end).join('\n')}\n`
}

const extractReleaseNotes = ({ cwd, version }: { cwd: string; version: string }) =>
  Effect.gen(function* () {
    const fsEffect = yield* FileSystem.FileSystem
    const changelogPath = `${cwd}/CHANGELOG.md`
    const changelog = yield* fsEffect.readFileString(changelogPath)
    const section = sliceChangelogSection(changelog, version)
    yield* fsEffect.makeDirectory(`${cwd}/release`, { recursive: true })
    const outPath = releaseNotesPath(cwd)
    yield* fsEffect.writeFileString(outPath, section)
    return outPath
  })

const readReleasePlan = (cwd: string, planPath: string) =>
  Effect.gen(function* () {
    const fsEffect = yield* FileSystem.FileSystem
    const absolutePlanPath = planPath.startsWith('/') === true ? planPath : `${cwd}/${planPath}`
    const content = yield* fsEffect.readFileString(absolutePlanPath)
    const plan = yield* Schema.decodeUnknownEffect(ReleasePlan)(JSON.parse(content))
    yield* validateReleasePlan(plan)
    return plan
  })

const writeReleasePlan = (cwd: string, plan: TReleasePlan) =>
  Effect.gen(function* () {
    yield* validateReleasePlan(plan)
    const fsEffect = yield* FileSystem.FileSystem
    yield* fsEffect.makeDirectory(`${cwd}/release`, { recursive: true })
    yield* fsEffect.writeFileString(releasePlanPath(cwd), `${JSON.stringify(plan, null, 2)}\n`)
  })

/**
 * Snapshot publishing only rewrites public `@livestore/*` packages.
 * The release flow operates on package names, so we need a stable mapping
 * back to the published package directory to patch `package.json` in place.
 */
const packageJsonPathFromPackageName = (cwd: string, packageName: string) =>
  `${cwd}/packages/@livestore/${packageName.replace('@livestore/', '')}/package.json`

/**
 * Snapshot versions must collapse workspace and ranged internal deps to the
 * exact published snapshot version. Leaving prerelease ranges in place lets
 * pnpm resolve a different snapshot build, which breaks standalone installs.
 */
const pinSnapshotDependencySpec = ({
  dependencyName,
  currentSpec,
  snapshotPackages,
  snapshotVersion,
}: {
  dependencyName: string
  currentSpec: string
  snapshotPackages: ReadonlySet<string>
  snapshotVersion: string
}) => {
  if (snapshotPackages.has(dependencyName) === false) return currentSpec
  if (currentSpec === snapshotVersion) return currentSpec
  if (currentSpec.startsWith('workspace:') === true) return snapshotVersion
  if (currentSpec === `^${snapshotVersion}` || currentSpec === `~${snapshotVersion}`) return snapshotVersion
  return currentSpec
}

/**
 * Rewrites internal dependency ranges after Genie generation so the published
 * snapshot graph is self-contained and installable outside the monorepo.
 */
export const rewriteSnapshotInternalDependencyRanges = ({
  cwd,
  snapshotPackages,
  snapshotVersion,
}: {
  cwd: string
  snapshotPackages: ReadonlyArray<string>
  snapshotVersion: string
}) =>
  Effect.gen(function* () {
    if (isSnapshotVersion(snapshotVersion) === false) return

    const fsEffect = yield* FileSystem.FileSystem
    const snapshotPackageSet = new Set(snapshotPackages)

    for (const packageName of snapshotPackages) {
      const packageJsonPath = packageJsonPathFromPackageName(cwd, packageName)
      const packageJson = yield* fsEffect.readFileString(packageJsonPath).pipe(
        Effect.flatMap((content) =>
          Effect.try({
            try: () => JSON.parse(content) as TMutablePackageJson,
            catch: (cause) => new PackageJsonParseError({ message: `Failed to parse ${packageJsonPath}`, cause }),
          }),
        ),
      )

      let rewriteCount = 0

      for (const field of dependencyFields) {
        const dependencies = packageJson[field]
        if (dependencies === undefined) continue

        for (const [dependencyName, currentSpec] of Object.entries(dependencies)) {
          const nextSpec = pinSnapshotDependencySpec({
            dependencyName,
            currentSpec,
            snapshotPackages: snapshotPackageSet,
            snapshotVersion,
          })

          if (nextSpec === currentSpec) continue

          dependencies[dependencyName] = nextSpec
          rewriteCount += 1
        }
      }

      if (rewriteCount === 0) continue

      yield* fsEffect.writeFileString(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)
      yield* Effect.log(`Pinned ${rewriteCount} internal snapshot dependency range(s) in ${packageName}`)
    }
  })

/**
 * Enumerates the publishable LiveStore release group packages for snapshot releases.
 * Topology is the package graph authority; generated package manifests are still
 * checked so a missing/private/misnamed package cannot be published silently.
 */
const listSnapshotPackages = (cwd: string) =>
  Effect.gen(function* () {
    const fsEffect = yield* FileSystem.FileSystem
    const topology = yield* fsEffect.readFileString(`${cwd}/scripts/src/generated/release-topology.json`).pipe(
      Effect.flatMap((content) =>
        Effect.try({
          try: () => JSON.parse(content) as TReleaseTopology,
          catch: (cause) =>
            new PackageJsonParseError({
              message: 'Failed to parse scripts/src/generated/release-topology.json',
              cause,
            }),
        }),
      ),
    )
    const packages: string[] = []

    for (const { dir, name: expectedName } of topology.publishablePackages) {
      const packageDir = `${cwd}/${dir}`
      const packageJsonPath = `${packageDir}/package.json`
      const hasPackageJson = yield* fsEffect.exists(packageJsonPath)
      if (hasPackageJson === false) continue

      const pkgResult = yield* fsEffect.readFileString(packageJsonPath).pipe(
        Effect.flatMap((content) =>
          Effect.try({
            try: () => JSON.parse(content) as { name?: unknown; private?: unknown },
            catch: (cause) => new PackageJsonParseError({ message: `Failed to parse ${packageJsonPath}`, cause }),
          }),
        ),
        Effect.result,
      )

      if (Result.isFailure(pkgResult)) {
        const error = pkgResult.failure
        const message = toErrorMessage(error)
        yield* Effect.logWarning(
          `Unable to read package metadata for ${packageJsonPath} while preparing snapshot summary: ${message}`,
        )
        continue
      }

      const pkgJson = pkgResult.success
      const name = typeof pkgJson.name === 'string' ? pkgJson.name : undefined
      if (name == null) {
        yield* Effect.logWarning(`Skipping ${packageJsonPath} while preparing snapshot summary: missing package name`)
        continue
      }

      if (name !== expectedName) {
        yield* Effect.logWarning(
          `Skipping ${packageJsonPath} while preparing snapshot summary: expected ${expectedName}, found ${name}`,
        )
        continue
      }

      if (pkgJson.private === true) {
        continue
      }

      packages.push(name)
    }

    packages.sort((a, b) => a.localeCompare(b))
    return packages
  }).pipe(
    Effect.catch((error) =>
      Effect.gen(function* () {
        const message = toErrorMessage(error)
        yield* Effect.logWarning(`Unable to enumerate snapshot packages: ${message}`)
        return [] as string[]
      }),
    ),
  )

const formatReleaseSummaryMarkdown = ({
  packages,
  version,
  npmTag,
  dryRun,
  title,
}: {
  packages: ReadonlyArray<string>
  version: string
  npmTag: string
  dryRun: boolean
  title: string
}) =>
  formatMarkdownTable({
    title,
    headers: ['Package', 'Version', 'Tag', 'Mode'],
    rows: packages.map((pkg) => [pkg, version, npmTag, dryRun === true ? 'dry-run' : 'published']),
    emptyMessage: '_No packages matched the release filter._',
  })

const restoreGeneratedReleaseFiles = (cwd: string) =>
  Effect.gen(function* () {
    /** Restore original dev versions (read-only) and verify files are in sync. */
    yield* cmd('DT_PASSTHROUGH=1 genie', { shell: true }).pipe(Effect.provide(CurrentWorkingDirectory.fromPath(cwd)))
    yield* cmd('DT_PASSTHROUGH=1 genie --check', { shell: true }).pipe(
      Effect.provide(CurrentWorkingDirectory.fromPath(cwd)),
    )
  }).pipe(
    Effect.catch((error) => Effect.logWarning(`Failed to restore generated release files: ${toErrorMessage(error)}`)),
  )

const packPackageForPublish = ({ cwd, pkg, version }: { cwd: string; pkg: string; version: string }) =>
  Effect.gen(function* () {
    const fsEffect = yield* FileSystem.FileSystem
    const pkgDir = `${cwd}/packages/${pkg}`
    const safePackageName = pkg.replaceAll('/', '__').replaceAll('@', '')
    const packDir = `${cwd}/tmp/release-pack/${version}/${safePackageName}`

    yield* fsEffect.remove(packDir, { recursive: true }).pipe(Effect.catch(() => Effect.void))
    yield* fsEffect.makeDirectory(packDir, { recursive: true })

    /**
     * Use pnpm for packaging because the repo intentionally keeps source-time
     * `exports`/`bin` in package.json and publish-time dist mappings in
     * `publishConfig`. `pnpm pack` materializes those mappings into the tarball;
     * plain `npm publish <directory>` would publish the source mappings instead.
     */
    yield* cmd(`DT_PASSTHROUGH=1 pnpm --dir ${pkgDir} pack --pack-destination ${packDir}`, { shell: true }).pipe(
      Effect.provide(CurrentWorkingDirectory.fromPath(cwd)),
    )

    const tarballs = (yield* fsEffect.readDirectory(packDir)).filter((entry) => entry.endsWith('.tgz'))
    if (tarballs.length !== 1) {
      return yield* Effect.fail(
        new Error(`Expected exactly one packed tarball for ${pkg}@${version}, found ${tarballs.length}`),
      )
    }

    return `${packDir}/${tarballs[0]}`
  })

const publishReleasePackages = ({
  cwd,
  version,
  npmTag,
  packages,
  dryRun,
  allowExisting,
  tscBin,
}: {
  cwd: string
  version: string
  npmTag: string
  packages: ReadonlyArray<string>
  dryRun: boolean
  allowExisting: boolean
  tscBin: string
}) =>
  Effect.gen(function* () {
    const isCI = process.env.CI === 'true' || process.env.CI === '1'

    /**
     * Regenerate all genie-managed files with the release version (writable for pnpm publish).
     * TODO: Replace CLI invocations with genie SDK once skipValidation is available
     * (https://github.com/overengineeringstudio/effect-utils/issues/196)
     */
    yield* cmd(`DT_PASSTHROUGH=1 LIVESTORE_RELEASE_VERSION=${version} genie --writeable`, { shell: true }).pipe(
      Effect.provide(CurrentWorkingDirectory.fromPath(cwd)),
    )

    yield* rewriteSnapshotInternalDependencyRanges({ cwd, snapshotPackages: packages, snapshotVersion: version })

    /** Rebuild TypeScript so dist/ picks up the release version from package.json (emit-only, type checking is separate). */
    yield* cmd(`DT_PASSTHROUGH=1 ${tscBin} --build tsconfig.dev.json --noCheck`, { shell: true }).pipe(
      Effect.provide(CurrentWorkingDirectory.fromPath(cwd)),
    )

    for (const pkg of packages) {
      const pkgDir = `${cwd}/packages/${pkg}`
      const cwdLayer = CurrentWorkingDirectory.fromPath(pkgDir)

      const alreadyPublished = yield* cmd(`npm view ${pkg}@${version} version`, {
        stdout: 'pipe',
        stderr: 'pipe',
      }).pipe(
        Effect.provide(cwdLayer),
        Effect.as(true),
        Effect.catchTag('CmdError', () => Effect.succeed(false)),
      )

      if (alreadyPublished === true) {
        if (dryRun === true || allowExisting === false) {
          return yield* Effect.fail(new Error(`${pkg}@${version} already exists on npm`))
        }

        yield* Effect.log(`${pkg}@${version} already published, skipping`)
        continue
      }

      const packedTarballPath = yield* packPackageForPublish({ cwd, pkg, version })
      const publishArgs = [
        'npm',
        'publish',
        packedTarballPath,
        `--tag=${npmTag}`,
        '--access=public',
        '--ignore-scripts',
      ]
      if (dryRun === true) publishArgs.push('--dry-run')
      const versionIsVisible = cmd(`npm view ${pkg}@${version} version`, { stdout: 'pipe', stderr: 'pipe' }).pipe(
        Effect.provide(cwdLayer),
        Effect.as(true),
        Effect.catchTag('CmdError', () => Effect.succeed(false)),
      )
      yield* cmd(`DT_PASSTHROUGH=1 ${publishArgs.join(' ')}`, { shell: true }).pipe(
        Effect.provide(cwdLayer),
        Effect.catchTag('CmdError', (error) => {
          if (isCI === false || dryRun === true || isSnapshotVersion(version) === false) return Effect.fail(error)

          return versionIsVisible.pipe(
            Effect.flatMap((isVisible) => {
              if (isVisible === true) {
                return Effect.logWarning(`${pkg}@${version} became visible after a failed publish; continuing`)
              }

              return Effect.logError(
                [
                  `Failed to publish ${pkg}@${version} from CI.`,
                  'Snapshot publishing must authenticate through npm trusted publishing from .github/workflows/release.yml.',
                  'Check that npm has this package configured for GitHub Actions trusted publishing and that this job uses a GitHub-hosted runner with id-token: write.',
                ].join(' '),
              ).pipe(Effect.andThen(Effect.fail(error)))
            }),
          )
        }),
      )
      yield* Effect.log(`${dryRun === true ? 'Dry-ran' : 'Published'} ${pkg}@${version}`)
    }

    if (dryRun === false) {
      yield* Effect.log('Verifying packages are available on the registry...')
      for (const pkg of packages) {
        yield* cmd(`npm view ${pkg}@${version} version`, { stdout: 'pipe', stderr: 'pipe' }).pipe(
          Effect.provide(CurrentWorkingDirectory.fromPath(cwd)),
          Effect.retry(Schedule.spaced('5 seconds').pipe(Schedule.take(60))),
        )
        yield* Effect.log(`Verified ${pkg}@${version}`)
      }
    }
  }).pipe(Effect.ensuring(restoreGeneratedReleaseFiles(cwd)))

export const releasePlanCommand = Cli.Command.make(
  'plan',
  {
    releaseVersion: Cli.Flag.text('release-version'),
    npmTag: Cli.Flag.text('npm-tag').pipe(Cli.Flag.withDefault('latest')),
    cwd: Cli.Flag.text('cwd').pipe(
      Cli.Flag.withDefault(
        process.env.WORKSPACE_ROOT ?? shouldNeverHappen(`WORKSPACE_ROOT is not set. Make sure to run 'direnv allow'`),
      ),
    ),
  },
  Effect.fn(function* ({ releaseVersion, npmTag, cwd }) {
    const validVersion = yield* validateReleaseVersion(releaseVersion)
    yield* writeReleasePlan(cwd, { schemaVersion: 1, version: validVersion, npmTag })
    yield* Effect.log(`Wrote release plan for ${validVersion} (${npmTag})`)
  }),
)

export const releaseStableCommand = Cli.Command.make(
  'stable',
  {
    plan: Cli.Flag.text('plan').pipe(Cli.Flag.withDefault('release/release-plan.json')),
    dryRun: Cli.Flag.boolean('dry-run').pipe(Cli.Flag.withDefault(false)),
    allowExisting: Cli.Flag.boolean('allow-existing').pipe(Cli.Flag.withDefault(false)),
    yes: Cli.Flag.boolean('yes').pipe(
      Cli.Flag.withDefault(false),
      Cli.Flag.withDescription('Skip interactive confirmation prompt'),
    ),
    cwd: Cli.Flag.text('cwd').pipe(
      Cli.Flag.withDefault(
        process.env.WORKSPACE_ROOT ?? shouldNeverHappen(`WORKSPACE_ROOT is not set. Make sure to run 'direnv allow'`),
      ),
    ),
    tscBin: Cli.Flag.text('tsc-bin').pipe(Cli.Flag.optional),
  },
  Effect.fn(function* ({ plan: planPath, dryRun, allowExisting, yes, cwd, tscBin: tscBinOption }) {
    const plan = yield* readReleasePlan(cwd, planPath)
    const packages = yield* listSnapshotPackages(cwd)
    const isCI = process.env.CI === 'true' || process.env.CI === '1'

    const skipConfirmation = yes || isCI
    if (skipConfirmation === false) {
      yield* Effect.log(
        `About to publish ${packages.length} package(s) as ${plan.version} with npm tag ${plan.npmTag}${dryRun === true ? ' (dry-run)' : ''}`,
      )
      const confirmed = yield* Cli.Prompt.confirm({ message: 'Proceed with stable release?' })
      if (confirmed === false) {
        yield* Effect.log('Stable release aborted by user')
        return
      }
    }

    const tsc = tscBinOption._tag === 'Some' ? tscBinOption.value : 'tsc'
    yield* publishReleasePackages({
      cwd,
      version: plan.version,
      npmTag: plan.npmTag,
      packages,
      dryRun,
      allowExisting,
      tscBin: tsc,
    })

    yield* appendGithubSummaryMarkdown({
      markdown: formatReleaseSummaryMarkdown({
        packages,
        version: plan.version,
        npmTag: plan.npmTag,
        dryRun,
        title: 'Stable release',
      }),
      context: 'stable release',
    })
  }),
)

export const releaseSnapshotCommand = Cli.Command.make(
  'snapshot',
  {
    gitShaOption: Cli.Flag.text('git-sha').pipe(Cli.Flag.optional),
    dryRun: Cli.Flag.boolean('dry-run').pipe(Cli.Flag.withDefault(false)),
    yes: Cli.Flag.boolean('yes').pipe(
      Cli.Flag.withDefault(false),
      Cli.Flag.withDescription('Skip interactive confirmation prompt'),
    ),
    cwd: Cli.Flag.text('cwd').pipe(
      Cli.Flag.withDefault(
        process.env.WORKSPACE_ROOT ?? shouldNeverHappen(`WORKSPACE_ROOT is not set. Make sure to run 'direnv allow'`),
      ),
    ),
    versionOption: Cli.Flag.text('version').pipe(Cli.Flag.optional),
    tscBin: Cli.Flag.text('tsc-bin').pipe(Cli.Flag.optional),
  },
  Effect.fn(function* ({ gitShaOption, dryRun, yes, cwd, versionOption, tscBin: tscBinOption }) {
    const gitSha =
      gitShaOption._tag === 'Some'
        ? gitShaOption.value
        : (yield* cmdText('git rev-parse HEAD').pipe(Effect.provide(CurrentWorkingDirectory.fromPath(cwd)))).trim()

    const snapshotVersion = versionOption._tag === 'Some' ? versionOption.value : `0.0.0-snapshot-${gitSha}`
    const snapshotPackages = yield* listSnapshotPackages(cwd)

    /** Confirm before proceeding unless --yes is passed or CI is detected. */
    const isCI = process.env.CI === 'true' || process.env.CI === '1'
    const skipConfirmation = yes || isCI
    if (skipConfirmation === false) {
      yield* Effect.log(
        `About to publish ${snapshotPackages.length} package(s) as ${snapshotVersion}${dryRun === true ? ' (dry-run)' : ''}`,
      )
      const confirmed = yield* Cli.Prompt.confirm({ message: 'Proceed with snapshot release?' })
      if (confirmed === false) {
        yield* Effect.log('Snapshot release aborted by user')
        return
      }
    }

    const tsc = tscBinOption._tag === 'Some' ? tscBinOption.value : 'tsc'
    yield* publishReleasePackages({
      cwd,
      version: snapshotVersion,
      npmTag: 'snapshot',
      packages: snapshotPackages,
      dryRun,
      allowExisting: true,
      tscBin: tsc,
    })

    yield* appendGithubSummaryMarkdown({
      markdown: formatReleaseSummaryMarkdown({
        packages: snapshotPackages,
        version: snapshotVersion,
        npmTag: 'snapshot',
        dryRun,
        title: 'Snapshot release',
      }),
      context: 'snapshot release',
    })
  }),
)

export const releaseNotesExtractCommand = Cli.Command.make(
  'extract-release-notes',
  {
    plan: Cli.Flag.text('plan').pipe(Cli.Flag.withDefault('release/release-plan.json')),
    cwd: Cli.Flag.text('cwd').pipe(
      Cli.Flag.withDefault(
        process.env.WORKSPACE_ROOT ?? shouldNeverHappen(`WORKSPACE_ROOT is not set. Make sure to run 'direnv allow'`),
      ),
    ),
  },
  Effect.fn(function* ({ plan: planPath, cwd }) {
    const plan = yield* readReleasePlan(cwd, planPath)
    const outPath = yield* extractReleaseNotes({ cwd, version: plan.version })
    yield* Effect.log(`Wrote release notes for ${plan.version} to ${outPath}`)
    console.log(outPath)
  }),
)

export const releaseCommand = Cli.Command.make('release').pipe(
  Cli.Command.withSubcommands([
    releasePlanCommand,
    releaseStableCommand,
    releaseSnapshotCommand,
    releaseNotesExtractCommand,
  ]),
)
