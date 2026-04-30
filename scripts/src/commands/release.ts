import semver from 'semver'

import { shouldNeverHappen } from '@livestore/utils'
import { CurrentWorkingDirectory, cmd, cmdText } from '@livestore/utils-dev/node'
import { Effect, FileSystem, Schedule, Schema } from '@livestore/utils/effect'
import { Cli } from '@livestore/utils/node'

import { appendGithubSummaryMarkdown, formatMarkdownTable } from '../shared/misc.ts'

class PackageJsonParseError extends Schema.TaggedError<PackageJsonParseError>()('PackageJsonParseError', {
  message: Schema.String,
  cause: Schema.Defect,
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

const releasePlanPath = (cwd: string) => `${cwd}/release/release-plan.json`

const readReleasePlan = (cwd: string, planPath: string) =>
  Effect.gen(function* () {
    const fsEffect = yield* FileSystem.FileSystem
    const absolutePlanPath = planPath.startsWith('/') === true ? planPath : `${cwd}/${planPath}`
    const content = yield* fsEffect.readFileString(absolutePlanPath)
    const plan = yield* Schema.decodeUnknown(ReleasePlan)(JSON.parse(content))
    yield* validateReleaseVersion(plan.version)
    return plan
  })

const writeReleasePlan = (cwd: string, plan: TReleasePlan) =>
  Effect.gen(function* () {
    yield* validateReleaseVersion(plan.version)
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
 * Enumerates the publishable `@livestore/*` packages for snapshot releases.
 * We intentionally read from the generated `package.json` files so the summary
 * and publish loop follow the exact publish surface for the current checkout.
 */
const listSnapshotPackages = (cwd: string) =>
  Effect.gen(function* () {
    const fsEffect = yield* FileSystem.FileSystem
    const baseDir = `${cwd}/packages/@livestore`
    const packages: string[] = []

    const baseExists = yield* fsEffect.exists(baseDir)
    if (baseExists === false) {
      yield* Effect.logWarning(`Snapshot packages directory not found at ${baseDir}`)
      return packages
    }

    const entries = yield* fsEffect.readDirectory(baseDir)

    for (const entry of entries) {
      /** `effect-playwright` is consumed as a workspace helper and is not part of the public snapshot set. */
      if (entry === 'effect-playwright') continue

      const packageJsonPath = `${baseDir}/${entry}/package.json`
      const hasPackageJson = yield* fsEffect.exists(packageJsonPath)
      if (hasPackageJson === false) continue

      const pkgResult = yield* fsEffect.readFileString(packageJsonPath).pipe(
        Effect.flatMap((content) =>
          Effect.try({
            try: () => JSON.parse(content) as { name?: unknown; private?: unknown },
            catch: (cause) => new PackageJsonParseError({ message: `Failed to parse ${packageJsonPath}`, cause }),
          }),
        ),
        Effect.either,
      )

      if (pkgResult._tag === 'Left') {
        const error = pkgResult.left
        const message = toErrorMessage(error)
        yield* Effect.logWarning(
          `Unable to read package metadata for ${packageJsonPath} while preparing snapshot summary: ${message}`,
        )
        continue
      }

      const pkgJson = pkgResult.right
      const name = typeof pkgJson.name === 'string' ? pkgJson.name : undefined
      if (name == null) {
        yield* Effect.logWarning(`Skipping ${packageJsonPath} while preparing snapshot summary: missing package name`)
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
    Effect.catchAll((error) =>
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
    Effect.catchAll((error) =>
      Effect.logWarning(`Failed to restore generated release files: ${toErrorMessage(error)}`),
    ),
  )

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

      const publishArgs = ['pnpm', 'publish', `--tag=${npmTag}`, '--access=public', '--no-git-checks']
      if (isCI === true) publishArgs.push('--provenance')
      if (dryRun === true) publishArgs.push('--dry-run')
      yield* cmd(`DT_PASSTHROUGH=1 ${publishArgs.join(' ')}`, { shell: true }).pipe(Effect.provide(cwdLayer))
      yield* Effect.log(`${dryRun === true ? 'Dry-ran' : 'Published'} ${pkg}@${version}`)
    }

    if (dryRun === false) {
      yield* Effect.log('Verifying packages are available on the registry...')
      for (const pkg of packages) {
        yield* cmd(`npm view ${pkg}@${version} version`, { stdout: 'pipe', stderr: 'pipe' }).pipe(
          Effect.provide(CurrentWorkingDirectory.fromPath(cwd)),
          Effect.retry(Schedule.spaced('5 seconds').pipe(Schedule.intersect(Schedule.recurs(60)))),
        )
        yield* Effect.log(`Verified ${pkg}@${version}`)
      }
    }
  }).pipe(Effect.ensuring(restoreGeneratedReleaseFiles(cwd)))

export const releasePlanCommand = Cli.Command.make(
  'plan',
  {
    releaseVersion: Cli.Options.text('release-version'),
    npmTag: Cli.Options.text('npm-tag').pipe(Cli.Options.withDefault('latest')),
    cwd: Cli.Options.text('cwd').pipe(
      Cli.Options.withDefault(
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
    plan: Cli.Options.text('plan').pipe(Cli.Options.withDefault('release/release-plan.json')),
    dryRun: Cli.Options.boolean('dry-run').pipe(Cli.Options.withDefault(false)),
    allowExisting: Cli.Options.boolean('allow-existing').pipe(Cli.Options.withDefault(false)),
    yes: Cli.Options.boolean('yes').pipe(
      Cli.Options.withDefault(false),
      Cli.Options.withDescription('Skip interactive confirmation prompt'),
    ),
    cwd: Cli.Options.text('cwd').pipe(
      Cli.Options.withDefault(
        process.env.WORKSPACE_ROOT ?? shouldNeverHappen(`WORKSPACE_ROOT is not set. Make sure to run 'direnv allow'`),
      ),
    ),
    tscBin: Cli.Options.text('tsc-bin').pipe(Cli.Options.optional),
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
    gitShaOption: Cli.Options.text('git-sha').pipe(Cli.Options.optional),
    dryRun: Cli.Options.boolean('dry-run').pipe(Cli.Options.withDefault(false)),
    yes: Cli.Options.boolean('yes').pipe(
      Cli.Options.withDefault(false),
      Cli.Options.withDescription('Skip interactive confirmation prompt'),
    ),
    cwd: Cli.Options.text('cwd').pipe(
      Cli.Options.withDefault(
        process.env.WORKSPACE_ROOT ?? shouldNeverHappen(`WORKSPACE_ROOT is not set. Make sure to run 'direnv allow'`),
      ),
    ),
    versionOption: Cli.Options.text('version').pipe(Cli.Options.optional),
    tscBin: Cli.Options.text('tsc-bin').pipe(Cli.Options.optional),
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

export const releaseCommand = Cli.Command.make('release').pipe(
  Cli.Command.withSubcommands([releasePlanCommand, releaseStableCommand, releaseSnapshotCommand]),
)
