import fs from 'node:fs'

import { shouldNeverHappen } from '@livestore/utils'
import { Effect, FileSystem } from '@livestore/utils/effect'
import { Cli } from '@livestore/utils/node'
import { CurrentWorkingDirectory, cmd, cmdText } from '@livestore/utils-dev/node'

import { appendGithubSummaryMarkdown, formatMarkdownTable } from '../shared/misc.ts'

const toErrorMessage = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

interface SnapshotPackage {
  name: string
  dir: string
  version: string
}

const listSnapshotPackages = (cwd: string) =>
  Effect.gen(function* () {
    const fsEffect = yield* FileSystem.FileSystem
    const baseDir = `${cwd}/packages/@livestore`
    const packages: SnapshotPackage[] = []

    const baseExists = yield* fsEffect.exists(baseDir)
    if (!baseExists) {
      yield* Effect.logWarning(`Snapshot packages directory not found at ${baseDir}`)
      return packages
    }

    const entries = yield* fsEffect.readDirectory(baseDir)

    for (const entry of entries) {
      if (entry === 'effect-playwright') continue

      const packageJsonPath = `${baseDir}/${entry}/package.json`
      const hasPackageJson = yield* fsEffect.exists(packageJsonPath)
      if (!hasPackageJson) continue

      const pkgResult = yield* fsEffect.readFileString(packageJsonPath).pipe(
        Effect.flatMap((content) =>
          Effect.try({
            try: () => JSON.parse(content) as Record<string, unknown>,
            catch: (cause) => new Error(`Failed to parse ${packageJsonPath}`, { cause }),
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
      if (!name) {
        yield* Effect.logWarning(`Skipping ${packageJsonPath} while preparing snapshot summary: missing package name`)
        continue
      }

      if (pkgJson.private === true) {
        continue
      }

      const version = typeof pkgJson.version === 'string' ? pkgJson.version : '0.0.0'
      packages.push({ name, dir: `${baseDir}/${entry}`, version })
    }

    packages.sort((a, b) => a.name.localeCompare(b.name))
    return packages
  }).pipe(
    Effect.catchAll((error) =>
      Effect.gen(function* () {
        const message = toErrorMessage(error)
        yield* Effect.logWarning(`Unable to enumerate snapshot packages: ${message}`)
        return [] as SnapshotPackage[]
      }),
    ),
  )

const updatePackageVersion = (packageJsonPath: string, version: string) => {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as Record<string, unknown>
  packageJson.version = version
  fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)
}

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
    rows: packages.map((pkg) => [pkg, snapshotVersion, 'snapshot', dryRun ? 'dry-run' : 'published']),
    emptyMessage: '_No packages matched the snapshot filter._',
  })

export const releaseSnapshotCommand = Cli.Command.make(
  'snapshot',
  {
    gitShaOption: Cli.Options.text('git-sha').pipe(Cli.Options.optional),
    dryRun: Cli.Options.boolean('dry-run').pipe(Cli.Options.withDefault(false)),
    cwd: Cli.Options.text('cwd').pipe(
      Cli.Options.withDefault(
        process.env.WORKSPACE_ROOT ?? shouldNeverHappen(`WORKSPACE_ROOT is not set. Make sure to run 'direnv allow'`),
      ),
    ),
    versionOption: Cli.Options.text('version').pipe(Cli.Options.optional),
  },
  Effect.fn(function* ({ gitShaOption, dryRun, cwd, versionOption }) {
    const originalVersion = yield* Effect.promise(() =>
      import('../../../packages/@livestore/common/package.json').then((m: any) => m.version as string),
    )

    const gitSha =
      gitShaOption._tag === 'Some'
        ? gitShaOption.value
        : yield* cmdText('git rev-parse HEAD').pipe(Effect.provide(CurrentWorkingDirectory.fromPath(cwd)))
    const snapshotVersion = versionOption._tag === 'Some' ? versionOption.value : `0.0.0-snapshot-${gitSha}`
    const snapshotPackages = yield* listSnapshotPackages(cwd)

    const versionFilePath = `${cwd}/packages/@livestore/common/src/version.ts`
    fs.writeFileSync(
      versionFilePath,
      fs.readFileSync(versionFilePath, 'utf8').replace(originalVersion, snapshotVersion),
    )

    for (const pkg of snapshotPackages) {
      const packageJsonPath = `${pkg.dir}/package.json`
      updatePackageVersion(packageJsonPath, snapshotVersion)
    }

    for (const pkg of snapshotPackages) {
      const publishArgs = ['bun', 'publish', '--tag', 'snapshot']
      if (dryRun) publishArgs.push('--dry-run')
      yield* cmd(publishArgs, { shell: false }).pipe(Effect.provide(CurrentWorkingDirectory.fromPath(pkg.dir)))
    }

    // Rollback package.json versions
    for (const pkg of snapshotPackages) {
      const packageJsonPath = `${pkg.dir}/package.json`
      updatePackageVersion(packageJsonPath, pkg.version)
    }

    // Rollback version.ts
    fs.writeFileSync(
      versionFilePath,
      fs.readFileSync(versionFilePath, 'utf8').replace(snapshotVersion, originalVersion),
    )

    yield* appendGithubSummaryMarkdown({
      markdown: formatSnapshotSummaryMarkdown({
        packages: snapshotPackages.map((pkg) => pkg.name),
        snapshotVersion,
        dryRun,
      }),
      context: 'snapshot release',
    })
  }),
)

export const releaseCommand = Cli.Command.make('release').pipe(Cli.Command.withSubcommands([releaseSnapshotCommand]))
