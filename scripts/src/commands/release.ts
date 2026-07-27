import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'

import semver from 'semver'

import { shouldNeverHappen } from '@livestore/utils'
import { CurrentWorkingDirectory, cmd, cmdText } from '@livestore/utils-dev/node'
import { Effect, FileSystem, Result, Schedule, Schema } from '@livestore/utils/effect'
import { Cli } from '@livestore/utils/node'

import { appendGithubSummaryMarkdown, formatMarkdownTable } from '../shared/misc.ts'

export type ReleaseSnapshotOptions = {
  readonly cwd: string
  readonly gitSha?: string | undefined
  readonly version?: string | undefined
  readonly dryRun?: boolean
  readonly yes?: boolean
  readonly tscBin?: string | undefined
}

class PackageJsonParseError extends Schema.TaggedErrorClass<PackageJsonParseError>()('PackageJsonParseError', {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

/** Registry has not converged on the published state yet; retryable by design. */
class RegistryPendingError extends Schema.TaggedErrorClass<RegistryPendingError>()('RegistryPendingError', {
  reason: Schema.String,
}) {}

/** Expected failures in the release/publish flow (validation, packing, npm state). */
class ReleaseError extends Schema.TaggedErrorClass<ReleaseError>()('ReleaseError', {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

/** Module-scoped JSON decoder; keeping the sync codec out of Effect generators avoids `schemaSyncInEffect`. */
const jsonParse = Schema.decodeUnknownSync(Schema.UnknownFromJsonString)

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

type TReleasePlan = (typeof ReleasePlan)['Type']

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
        ? Effect.fail(new ReleaseError({ message: `Invalid npm semver version: ${version}` }))
        : version.includes('-snapshot-') === true
          ? Effect.fail(
              new ReleaseError({ message: `Stable release versions must not use snapshot versions: ${version}` }),
            )
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
    const plan = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ReleasePlan))(content)
    yield* validateReleasePlan(plan)
    return plan
  })

const writeReleasePlan = (cwd: string, plan: TReleasePlan) =>
  Effect.gen(function* () {
    yield* validateReleasePlan(plan)
    const fsEffect = yield* FileSystem.FileSystem
    yield* fsEffect.makeDirectory(`${cwd}/release`, { recursive: true })
    const encodedPlan = yield* Schema.encodeEffect(Schema.jsonStringIndented(ReleasePlan))(plan).pipe(Effect.orDie)
    yield* fsEffect.writeFileString(releasePlanPath(cwd), `${encodedPlan}\n`)
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
            try: () => jsonParse(content) as TMutablePackageJson,
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

      const encodedPackageJson = yield* Schema.encodeEffect(Schema.jsonStringIndented(Schema.Unknown))(
        packageJson,
      ).pipe(Effect.orDie)
      yield* fsEffect.writeFileString(packageJsonPath, `${encodedPackageJson}\n`)
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
          try: () => jsonParse(content) as TReleaseTopology,
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
            try: () => jsonParse(content) as { name?: unknown; private?: unknown },
            catch: (cause) => new PackageJsonParseError({ message: `Failed to parse ${packageJsonPath}`, cause }),
          }),
        ),
        Effect.result,
      )

      if (Result.isFailure(pkgResult) === true) {
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
    yield* cmd('DT_PASSTHROUGH=1 DEVENV_TASK_PASSTHROUGH=1 genie', { shell: true }).pipe(
      Effect.provide(CurrentWorkingDirectory.fromPath(cwd)),
    )
    yield* cmd('DT_PASSTHROUGH=1 DEVENV_TASK_PASSTHROUGH=1 genie --check', { shell: true }).pipe(
      Effect.provide(CurrentWorkingDirectory.fromPath(cwd)),
    )
  }).pipe(
    Effect.catch((error) => Effect.logWarning(`Failed to restore generated release files: ${toErrorMessage(error)}`)),
  )

/** What the npm registry currently serves for a package we just published. */
export type TRemoteRegistryState = {
  /** `undefined` when the exact version is not visible on the registry (yet). */
  readonly version: string | undefined
  /** `dist.integrity` of the served tarball, e.g. `sha512-…`. */
  readonly integrity: string | undefined
  /** Version the mutable dist-tag resolves to; `undefined` when the tag does not exist. */
  readonly distTag: string | undefined
}

/**
 * Outcome of comparing the registry against what we intended to publish.
 *
 * `pending` and `mismatch` are separated because they need opposite handling:
 * registry propagation is eventually consistent and worth retrying, whereas a
 * tarball digest that disagrees with what we packed can never become correct.
 */
export type TRegistryVerification =
  | { readonly _tag: 'ok' }
  /** Registry has not caught up yet; retrying may resolve this. */
  | { readonly _tag: 'pending'; readonly reason: string }
  /** Registry disagrees with what we published; retrying cannot fix it. */
  | { readonly _tag: 'mismatch'; readonly reason: string }

/**
 * Compare what the registry serves against what we intended to publish.
 *
 * This holds stable releases to the standard the snapshot path already enforces in
 * `release.yml` ("Verify complete immutable registry cohort"): the version must be
 * visible, the served tarball digest must match the artifact we packed, and the
 * mutable dist-tag must resolve to exactly this version.
 *
 * The dist-tag check is the one that catches a silent partial release: publishing
 * can succeed while `latest` keeps pointing at the previous version, so
 * `npm install @livestore/livestore` still serves the old release even though
 * `release/version.json` has advanced.
 */
export const registryVerification = ({
  pkg,
  version,
  npmTag,
  localIntegrity,
  remote,
}: {
  readonly pkg: string
  readonly version: string
  readonly npmTag: string
  /** Absent when the package was already on the registry and we never packed it locally. */
  readonly localIntegrity: string | undefined
  readonly remote: TRemoteRegistryState
}): TRegistryVerification => {
  if (remote.version === undefined) {
    return { _tag: 'pending', reason: `${pkg}@${version} is not visible on the registry yet` }
  }

  if (remote.version !== version) {
    return { _tag: 'mismatch', reason: `${pkg}: registry serves version ${remote.version}, expected ${version}` }
  }

  // A different tarball under the same version means we published something other
  // than what we packed. Immutable on npm, so this can only be resolved by a human.
  if (localIntegrity !== undefined && remote.integrity !== undefined && remote.integrity !== localIntegrity) {
    return {
      _tag: 'mismatch',
      reason: `${pkg}@${version}: registry tarball digest ${remote.integrity} does not match the locally packed ${localIntegrity}`,
    }
  }

  if (remote.distTag === undefined) {
    return {
      _tag: 'pending',
      reason: `${pkg}: dist-tag "${npmTag}" is absent, so ${version} published but nothing resolves to it`,
    }
  }

  if (remote.distTag !== version) {
    return {
      _tag: 'pending',
      reason: `${pkg}: dist-tag "${npmTag}" points at ${remote.distTag}, expected ${version}`,
    }
  }

  return { _tag: 'ok' }
}

/** npm's `dist.integrity` format: base64-encoded SHA-512 of the tarball, algorithm-prefixed. */
const tarballIntegrity = (tarballPath: string) =>
  Effect.tryPromise({
    try: async () =>
      `sha512-${createHash('sha512')
        .update(await readFile(tarballPath))
        .digest('base64')}`,
    catch: (cause) => new ReleaseError({ message: `Failed to hash ${tarballPath}`, cause }),
  })

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
    yield* cmd(`DT_PASSTHROUGH=1 DEVENV_TASK_PASSTHROUGH=1 pnpm --dir ${pkgDir} pack --pack-destination ${packDir}`, {
      shell: true,
    }).pipe(Effect.provide(CurrentWorkingDirectory.fromPath(cwd)))

    const tarballs = (yield* fsEffect.readDirectory(packDir)).filter((entry) => entry.endsWith('.tgz'))
    if (tarballs.length !== 1) {
      return yield* new ReleaseError({
        message: `Expected exactly one packed tarball for ${pkg}@${version}, found ${tarballs.length}`,
      })
    }

    return `${packDir}/${tarballs[0]}`
  })

/**
 * Registry payloads we cannot parse are reported as absent rather than as errors:
 * "no data" and "unexpected data" are both handled as "not converged yet", which the
 * caller's retry schedule eventually turns into a hard failure.
 */
const tolerate = <A>(decode: () => A): A | undefined => {
  try {
    return decode()
  } catch {
    return undefined
  }
}

const RegistryManifest = Schema.Struct({
  version: Schema.String,
  dist: Schema.optional(Schema.Struct({ integrity: Schema.optional(Schema.String) })),
})

const RegistryDistTags = Schema.Record(Schema.String, Schema.String)

/**
 * Read what the registry currently serves for `pkg`.
 *
 * Absent data decodes to `undefined` rather than failing: `npm view` exits non-zero
 * for a version that has not propagated yet, and that is a "retry", not an error.
 * The caller's retry schedule decides when missing data becomes a failure.
 */
/** Bounded wait for npm's registry to converge after a publish (~5 minutes). */
const registryConvergenceSchedule = Schedule.spaced('5 seconds').pipe(Schedule.upTo({ times: 60 }))

/**
 * Verify one package against the registry, retrying only while the registry has
 * not converged. A `mismatch` fails immediately; exhausting the schedule turns a
 * lingering `pending` into a release failure.
 *
 * Takes `readState` as a parameter so the retry policy can be tested without npm.
 */
export const verifyPackageOnRegistry = <R>({
  readState,
  pkg,
  version,
  npmTag,
  localIntegrity,
  schedule = registryConvergenceSchedule,
}: {
  readonly readState: Effect.Effect<TRemoteRegistryState, never, R>
  readonly pkg: string
  readonly version: string
  readonly npmTag: string
  readonly localIntegrity: string | undefined
  readonly schedule?: Schedule.Schedule<unknown, unknown, never>
}) =>
  Effect.gen(function* () {
    const remote = yield* readState
    const result = registryVerification({ pkg, version, npmTag, localIntegrity, remote })

    if (result._tag === 'mismatch') return yield* new ReleaseError({ message: result.reason })
    if (result._tag === 'pending') return yield* new RegistryPendingError({ reason: result.reason })
  }).pipe(
    Effect.retry({ schedule, while: (error) => error._tag === 'RegistryPendingError' }),
    Effect.catchTag(
      'RegistryPendingError',
      (error) =>
        new ReleaseError({ message: `${error.reason} — registry did not converge within the verification window` }),
    ),
  )

export const readRegistryState = ({
  cwd,
  pkg,
  version,
  npmTag,
}: {
  cwd: string
  pkg: string
  version: string
  npmTag: string
}) =>
  Effect.gen(function* () {
    const cwdLayer = CurrentWorkingDirectory.fromPath(cwd)

    const viewJson = (args: ReadonlyArray<string>) =>
      cmdText(['npm', 'view', ...args, '--json'], { stderr: 'pipe' }).pipe(
        Effect.provide(cwdLayer),
        Effect.map((raw) => tolerate(() => jsonParse(raw.trim()))),
        Effect.orElseSucceed(() => undefined),
      )

    const manifest = yield* viewJson([`${pkg}@${version}`]).pipe(
      Effect.map((raw) => tolerate(() => Schema.decodeUnknownSync(RegistryManifest)(raw))),
    )
    const distTags = yield* viewJson([pkg, 'dist-tags']).pipe(
      Effect.map((raw) => tolerate(() => Schema.decodeUnknownSync(RegistryDistTags)(raw))),
    )

    return {
      version: manifest?.version,
      integrity: manifest?.dist?.integrity,
      distTag: distTags?.[npmTag],
    } satisfies TRemoteRegistryState
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
    /** Digest of each tarball we packed, so verification can prove the registry serves that exact artifact. */
    const localIntegrityByPackage = new Map<string, string>()

    /**
     * Regenerate all genie-managed files with the release version (writable for pnpm publish).
     * TODO: Replace CLI invocations with genie SDK once skipValidation is available
     * (https://github.com/overengineeringstudio/effect-utils/issues/196)
     */
    yield* cmd(`DT_PASSTHROUGH=1 DEVENV_TASK_PASSTHROUGH=1 LIVESTORE_RELEASE_VERSION=${version} genie --writeable`, {
      shell: true,
    }).pipe(Effect.provide(CurrentWorkingDirectory.fromPath(cwd)))

    yield* rewriteSnapshotInternalDependencyRanges({ cwd, snapshotPackages: packages, snapshotVersion: version })

    /** Rebuild TypeScript so dist/ picks up the release version from package.json (emit-only, type checking is separate). */
    yield* cmd(`DT_PASSTHROUGH=1 DEVENV_TASK_PASSTHROUGH=1 ${tscBin} --build tsconfig.dev.json --noCheck`, {
      shell: true,
    }).pipe(Effect.provide(CurrentWorkingDirectory.fromPath(cwd)))

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
          return yield* new ReleaseError({ message: `${pkg}@${version} already exists on npm` })
        }

        yield* Effect.log(`${pkg}@${version} already published, skipping`)
        continue
      }

      const packedTarballPath = yield* packPackageForPublish({ cwd, pkg, version })
      localIntegrityByPackage.set(pkg, yield* tarballIntegrity(packedTarballPath))
      const publishArgs = [
        'npm',
        'publish',
        packedTarballPath,
        `--tag=${npmTag}`,
        '--access=public',
        '--ignore-scripts',
      ]
      if (dryRun === true) {
        publishArgs.push('--dry-run')
      } else if (process.env.GITHUB_ACTIONS === 'true') {
        // SLSA provenance attestation, minted from the job's OIDC id-token. The snapshot
        // path and the DevTools artifact publisher already do this; without it stable
        // releases would be the only artifact we ship unattested.
        publishArgs.push('--provenance')
      }
      const versionIsVisible = cmd(`npm view ${pkg}@${version} version`, { stdout: 'pipe', stderr: 'pipe' }).pipe(
        Effect.provide(cwdLayer),
        Effect.as(true),
        Effect.catchTag('CmdError', () => Effect.succeed(false)),
      )
      yield* cmd(`DT_PASSTHROUGH=1 DEVENV_TASK_PASSTHROUGH=1 ${publishArgs.join(' ')}`, { shell: true }).pipe(
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
      yield* Effect.log('Verifying packages on the registry...')
      for (const pkg of packages) {
        yield* verifyPackageOnRegistry({
          readState: readRegistryState({ cwd, pkg, version, npmTag }),
          pkg,
          version,
          npmTag,
          localIntegrity: localIntegrityByPackage.get(pkg),
        })

        yield* Effect.log(`Verified ${pkg}@${version} (dist-tag ${npmTag} -> ${version})`)
      }
    }
  }).pipe(Effect.ensuring(restoreGeneratedReleaseFiles(cwd)))

export const releasePlanCommand = Cli.Command.make(
  'plan',
  {
    releaseVersion: Cli.Flag.string('release-version'),
    npmTag: Cli.Flag.string('npm-tag').pipe(Cli.Flag.withDefault('latest')),
    cwd: Cli.Flag.string('cwd').pipe(
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
    plan: Cli.Flag.string('plan').pipe(Cli.Flag.withDefault('release/release-plan.json')),
    dryRun: Cli.Flag.boolean('dry-run').pipe(Cli.Flag.withDefault(false)),
    allowExisting: Cli.Flag.boolean('allow-existing').pipe(Cli.Flag.withDefault(false)),
    yes: Cli.Flag.boolean('yes').pipe(
      Cli.Flag.withDefault(false),
      Cli.Flag.withDescription('Skip interactive confirmation prompt'),
    ),
    cwd: Cli.Flag.string('cwd').pipe(
      Cli.Flag.withDefault(
        process.env.WORKSPACE_ROOT ?? shouldNeverHappen(`WORKSPACE_ROOT is not set. Make sure to run 'direnv allow'`),
      ),
    ),
    tscBin: Cli.Flag.string('tsc-bin').pipe(Cli.Flag.optional),
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

export const releaseSnapshot = Effect.fn(function* ({
  gitSha: gitShaOption,
  dryRun = false,
  yes = false,
  cwd,
  version: versionOption,
  tscBin = 'tsc',
}: ReleaseSnapshotOptions) {
  const gitSha =
    gitShaOption ??
    (yield* cmdText('git rev-parse HEAD').pipe(Effect.provide(CurrentWorkingDirectory.fromPath(cwd)))).trim()

  const snapshotVersion = versionOption ?? `0.0.0-snapshot-${gitSha}`
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

  yield* publishReleasePackages({
    cwd,
    version: snapshotVersion,
    npmTag: 'snapshot',
    packages: snapshotPackages,
    dryRun,
    allowExisting: true,
    tscBin,
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
})

export const packSnapshot = Effect.fn(function* ({
  gitSha,
  prNumber,
  cwd,
  outDir,
  tscBin = 'tsc',
}: {
  gitSha: string
  prNumber: number
  cwd: string
  outDir: string
  tscBin?: string
}) {
  if (/^[0-9a-f]{40}$/.test(gitSha) === false) {
    return yield* new ReleaseError({
      message: `Snapshot Git SHA must be exactly 40 lowercase hexadecimal characters: ${gitSha}`,
    })
  }
  if (Number.isSafeInteger(prNumber) === false || prNumber < 1) {
    return yield* new ReleaseError({ message: `Snapshot PR number must be a positive integer: ${prNumber}` })
  }

  const version = `0.0.0-snapshot-pr.${prNumber}.${gitSha}`
  const packages = yield* listSnapshotPackages(cwd)

  if (packages.length === 0) {
    return yield* new ReleaseError({ message: 'Snapshot package topology is empty' })
  }

  yield* Effect.tryPromise({
    try: async () => {
      await rm(outDir, { recursive: true, force: true })
      await mkdir(outDir, { recursive: true })
    },
    catch: (cause) => new ReleaseError({ message: `Failed to prepare snapshot artifact directory ${outDir}`, cause }),
  })

  const tarballs = yield* Effect.gen(function* () {
    yield* cmd(`DT_PASSTHROUGH=1 DEVENV_TASK_PASSTHROUGH=1 LIVESTORE_RELEASE_VERSION=${version} genie --writeable`, {
      shell: true,
    }).pipe(Effect.provide(CurrentWorkingDirectory.fromPath(cwd)))
    yield* rewriteSnapshotInternalDependencyRanges({ cwd, snapshotPackages: packages, snapshotVersion: version })
    yield* cmd(`DT_PASSTHROUGH=1 DEVENV_TASK_PASSTHROUGH=1 ${tscBin} --build tsconfig.dev.json --noCheck`, {
      shell: true,
    }).pipe(Effect.provide(CurrentWorkingDirectory.fromPath(cwd)))

    return yield* Effect.forEach(packages, (pkg) => packPackageForPublish({ cwd, pkg, version }), {
      concurrency: 1,
    })
  }).pipe(Effect.ensuring(restoreGeneratedReleaseFiles(cwd)))

  yield* Effect.tryPromise({
    try: async () => {
      for (const tarball of tarballs) {
        await copyFile(tarball, path.join(outDir, path.basename(tarball)))
      }
    },
    catch: (cause) => new ReleaseError({ message: `Failed to stage snapshot tarballs in ${outDir}`, cause }),
  })

  yield* Effect.log(`Packed ${tarballs.length} package(s) as ${version} in ${outDir}`)
})

export const packSnapshotCommand = Cli.Command.make(
  'snapshot-pack',
  {
    gitSha: Cli.Flag.string('git-sha'),
    prNumber: Cli.Flag.integer('pr-number'),
    outDir: Cli.Flag.string('out-dir'),
    cwd: Cli.Flag.string('cwd').pipe(
      Cli.Flag.withDefault(
        process.env.WORKSPACE_ROOT ?? shouldNeverHappen(`WORKSPACE_ROOT is not set. Make sure to run 'direnv allow'`),
      ),
    ),
    tscBin: Cli.Flag.string('tsc-bin').pipe(Cli.Flag.optional),
  },
  ({ gitSha, prNumber, outDir, cwd, tscBin }) =>
    packSnapshot({
      gitSha,
      prNumber,
      cwd,
      outDir,
      ...(tscBin._tag === 'Some' ? { tscBin: tscBin.value } : {}),
    }),
)

export const releaseSnapshotCommand = Cli.Command.make(
  'snapshot',
  {
    gitShaOption: Cli.Flag.string('git-sha').pipe(Cli.Flag.optional),
    dryRun: Cli.Flag.boolean('dry-run').pipe(Cli.Flag.withDefault(false)),
    yes: Cli.Flag.boolean('yes').pipe(
      Cli.Flag.withDefault(false),
      Cli.Flag.withDescription('Skip interactive confirmation prompt'),
    ),
    cwd: Cli.Flag.string('cwd').pipe(
      Cli.Flag.withDefault(
        process.env.WORKSPACE_ROOT ?? shouldNeverHappen(`WORKSPACE_ROOT is not set. Make sure to run 'direnv allow'`),
      ),
    ),
    versionOption: Cli.Flag.string('version').pipe(Cli.Flag.optional),
    tscBin: Cli.Flag.string('tsc-bin').pipe(Cli.Flag.optional),
  },
  ({ gitShaOption, dryRun, yes, cwd, versionOption, tscBin }) =>
    releaseSnapshot({
      gitSha: gitShaOption._tag === 'Some' ? gitShaOption.value : undefined,
      dryRun,
      yes,
      cwd,
      version: versionOption._tag === 'Some' ? versionOption.value : undefined,
      tscBin: tscBin._tag === 'Some' ? tscBin.value : undefined,
    }),
)

export const releaseNotesExtractCommand = Cli.Command.make(
  'extract-release-notes',
  {
    plan: Cli.Flag.string('plan').pipe(Cli.Flag.withDefault('release/release-plan.json')),
    cwd: Cli.Flag.string('cwd').pipe(
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
    packSnapshotCommand,
    releaseNotesExtractCommand,
  ]),
)
