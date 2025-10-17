import fs from 'node:fs'

import { shouldNeverHappen } from '@livestore/utils'
import { Effect, FileSystem } from '@livestore/utils/effect'
import { Cli } from '@livestore/utils/node'
import { cmd, cmdText } from '@livestore/utils-dev/node'

import { appendGithubSummaryMarkdown, formatMarkdownTable } from '../shared/misc.ts'

const toErrorMessage = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

const listSnapshotPackages = (cwd: string) =>
  Effect.gen(function* () {
    const fsEffect = yield* FileSystem.FileSystem
    const baseDir = `${cwd}/packages/@livestore`
    const packages: string[] = []

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
            try: () => JSON.parse(content) as { name?: unknown; private?: unknown },
            catch: (cause) => cause as unknown,
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
  },
  Effect.fn(function* ({ gitShaOption, dryRun, cwd }) {
    const originalVersion = yield* Effect.promise(() =>
      import('../../../packages/@livestore/common/package.json').then((m: any) => m.version as string),
    )

    const gitSha = gitShaOption._tag === 'Some' ? gitShaOption.value : yield* cmdText('git rev-parse HEAD', { cwd })
    const filterStr = '--filter @livestore/* --filter !@livestore/effect-playwright'

    const snapshotVersion = `0.0.0-snapshot-${gitSha}`
    const snapshotPackages = yield* listSnapshotPackages(cwd)

    const versionFilePath = `${cwd}/packages/@livestore/common/src/version.ts`
    fs.writeFileSync(
      versionFilePath,
      fs.readFileSync(versionFilePath, 'utf8').replace(originalVersion, snapshotVersion),
    )

    yield* cmd(`pnpm ${filterStr} exec -- pnpm version '${snapshotVersion}' --no-git-tag-version`, {
      shell: true,
      cwd,
    })

    yield* cmd(`pnpm ${filterStr} exec -- pnpm publish --tag=snapshot --no-git-checks ${dryRun ? '--dry-run' : ''}`, {
      shell: true,
      cwd,
    })

    // Rollback package.json versions
    yield* cmd(`pnpm ${filterStr} exec -- pnpm version '${originalVersion}' --no-git-tag-version`, {
      shell: true,
      cwd,
    })

    // Rollback version.ts
    fs.writeFileSync(
      versionFilePath,
      fs.readFileSync(versionFilePath, 'utf8').replace(snapshotVersion, originalVersion),
    )

    yield* appendGithubSummaryMarkdown({
      markdown: formatSnapshotSummaryMarkdown({
        packages: snapshotPackages,
        snapshotVersion,
        dryRun,
      }),
      context: 'snapshot release',
    })
  }),
)

export const releaseCommand = Cli.Command.make('release').pipe(Cli.Command.withSubcommands([releaseSnapshotCommand]))
