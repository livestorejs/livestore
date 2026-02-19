import { shouldNeverHappen } from '@livestore/utils'
import { CurrentWorkingDirectory, cmd, cmdText } from '@livestore/utils-dev/node'
import { Effect, FileSystem, Schedule, Schema } from '@livestore/utils/effect'
import { Cli } from '@livestore/utils/node'

import { appendGithubSummaryMarkdown, formatMarkdownTable } from '../shared/misc.ts'

class PackageJsonParseError extends Schema.TaggedError<PackageJsonParseError>()('PackageJsonParseError', {
  message: Schema.String,
  cause: Schema.Defect,
}) {}

const toErrorMessage = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

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

const formatSnapshotSummaryMarkdown = ({
  packages,
  snapshotVersion,
  dryRun,
}: {
  packages: ReadonlyArray<string>
  snapshotVersion: string
  dryRun: boolean
}) =>
  formatMarkdownTable({
    title: 'Snapshot release',
    headers: ['Package', 'Version', 'Tag', 'Mode'],
    rows: packages.map((pkg) => [pkg, snapshotVersion, 'snapshot', dryRun === true ? 'dry-run' : 'published']),
    emptyMessage: '_No packages matched the snapshot filter._',
  })

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
        `About to publish ${snapshotPackages.length} package(s) as ${snapshotVersion}${dryRun ? ' (dry-run)' : ''}`,
      )
      const confirmed = yield* Cli.Prompt.confirm({ message: 'Proceed with snapshot release?' })
      if (confirmed === false) {
        yield* Effect.log('Snapshot release aborted by user')
        return
      }
    }

    /**
     * Regenerate all genie-managed files with snapshot version (writable for pnpm publish).
     * TODO: Replace CLI invocations with genie SDK once skipValidation is available
     * (https://github.com/overengineeringstudio/effect-utils/issues/196)
     */
    yield* cmd(`LIVESTORE_RELEASE_VERSION=${snapshotVersion} genie --writeable`, { shell: true }).pipe(
      Effect.provide(CurrentWorkingDirectory.fromPath(cwd)),
    )

    /** Rebuild TypeScript so dist/ picks up the snapshot version from package.json (emit-only, type checking is separate) */
    const tsc = tscBinOption._tag === 'Some' ? tscBinOption.value : 'tsc'
    yield* cmd(`${tsc} --build tsconfig.dev.json --noCheck`, { shell: true }).pipe(
      Effect.provide(CurrentWorkingDirectory.fromPath(cwd)),
    )

    /**
     * Publish each package sequentially via pnpm publish.
     * pnpm publish resolves workspace:* → concrete versions automatically,
     * then delegates to the system npm binary for OIDC trusted publishing.
     */
    for (const pkg of snapshotPackages) {
      const pkgDir = `${cwd}/packages/${pkg}`
      const cwdLayer = CurrentWorkingDirectory.fromPath(pkgDir)

      /** Pre-check: skip if already published (idempotent reruns). Uses cmd() which validates exit codes. */
      const alreadyPublished = yield* cmd(`npm view ${pkg}@${snapshotVersion} version`, {
        stdout: 'pipe',
        stderr: 'pipe',
      }).pipe(
        Effect.provide(cwdLayer),
        Effect.as(true),
        Effect.catchTag('CmdError', () => Effect.succeed(false)),
      )

      if (alreadyPublished === true) {
        yield* Effect.log(`${pkg}@${snapshotVersion} already published, skipping`)
        continue
      }

      const publishArgs = ['pnpm', 'publish', '--tag=snapshot', '--access=public', '--no-git-checks']
      if (isCI === true) publishArgs.push('--provenance')
      if (dryRun === true) publishArgs.push('--dry-run')
      yield* cmd(publishArgs.join(' '), { shell: true }).pipe(Effect.provide(cwdLayer))
      yield* Effect.log(`Published ${pkg}@${snapshotVersion}`)
    }

    /**
     * Verify all published packages are installable from the registry.
     * npm publish returns 200 before the package is globally available due to
     * CouchDB replication + Fastly CDN cache propagation (up to ~5 minutes).
     * See https://github.com/livestorejs/livestore/issues/1039
     */
    if (dryRun === false) {
      yield* Effect.log('Verifying snapshot packages are available on the registry...')
      for (const pkg of snapshotPackages) {
        yield* cmd(`npm view ${pkg}@${snapshotVersion} version`, { stdout: 'pipe', stderr: 'pipe' }).pipe(
          Effect.provide(CurrentWorkingDirectory.fromPath(cwd)),
          Effect.retry(Schedule.spaced('5 seconds').pipe(Schedule.intersect(Schedule.recurs(60)))),
        )
        yield* Effect.log(`Verified ${pkg}@${snapshotVersion}`)
      }
    }

    /** Restore original dev versions (read-only) and verify files are in sync */
    yield* cmd('genie', { shell: true }).pipe(Effect.provide(CurrentWorkingDirectory.fromPath(cwd)))
    yield* cmd('genie --check', { shell: true }).pipe(Effect.provide(CurrentWorkingDirectory.fromPath(cwd)))

    yield* appendGithubSummaryMarkdown({
      markdown: formatSnapshotSummaryMarkdown({ packages: snapshotPackages, snapshotVersion, dryRun }),
      context: 'snapshot release',
    })
  }),
)

export const releaseCommand = Cli.Command.make('release').pipe(Cli.Command.withSubcommands([releaseSnapshotCommand]))
