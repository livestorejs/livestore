#!/usr/bin/env bun

/**
 * Dependency Update Script - Consistent dependency management for monorepo
 *
 * How It Works:
 *
 * 1. **Discovery**: Uses `npm-check-updates --jsonUpgraded` to find all available updates
 * 2. **Expo constraints**: Fetches constraints from Expo API (113+ managed packages)
 * 3. **Global application**: Applies Expo constraints to ALL packages for consistency
 * 4. **Direct updates**: Modifies package.json files directly, then runs `pnpm install --fix-lockfile`
 * 5. **Validation**: Runs `syncpack` and `expo install --check` automatically
 *
 * Benefits: Ensures consistent versions across the entire monorepo, preventing
 * type conflicts and bundle bloat from multiple versions of the same package.
 */

import fs from 'node:fs'
import {
  Console,
  Effect,
  FetchHttpClient,
  HttpClient,
  HttpClientResponse,
  Layer,
  Logger,
  LogLevel,
  Schema,
} from '@livestore/utils/effect'
import { Cli, PlatformNode } from '@livestore/utils/node'
import { cmd, cmdText } from '@livestore/utils-dev/node'

// Dependencies that should never be automatically updated
const DEPENDENCY_DENY_LIST = [
  '@playwright/test', // Must be updated manually in lockstep with Nix flake dependency
] as const

// Types for our dependency update workflow
const PackageUpdate = Schema.Struct({
  name: Schema.String,
  currentVersion: Schema.String,
  targetVersion: Schema.String,
})

const PackageFileUpdates = Schema.Record({ key: Schema.String, value: Schema.String })
const NCUOutput = Schema.Record({ key: Schema.String, value: PackageFileUpdates })

const ExpoConstraints = Schema.Record({ key: Schema.String, value: Schema.String })

const PatchedDependencies = Schema.Record({ key: Schema.String, value: Schema.String })

// Schema for Expo API response
const ExpoApiItem = Schema.Struct({
  npmPackage: Schema.String,
  versionRange: Schema.String,
})

const ExpoApiResponse = Schema.Struct({
  data: Schema.Array(ExpoApiItem),
})

interface UpdateResult {
  packageFile: string
  updates: Array<typeof PackageUpdate.Type>
  success: boolean
  error?: string
}

// Core Effects for dependency management
const readPatchedDependencies = () =>
  Effect.withSpan('readPatchedDependencies')(
    Effect.gen(function* () {
      const packageJsonPath = './package.json'

      const packageJsonContent = yield* Effect.try({
        try: () => fs.readFileSync(packageJsonPath, 'utf8'),
        catch: () => new Error('Failed to read root package.json'),
      })

      const packageJson = yield* Effect.try({
        try: () => JSON.parse(packageJsonContent),
        catch: () => new Error('Failed to parse root package.json'),
      })

      const patchedDeps = packageJson?.pnpm?.patchedDependencies ?? {}
      const validated = yield* Schema.decodeUnknown(PatchedDependencies)(patchedDeps)

      // Extract just package names from package@version format
      return Object.keys(validated).map((packageWithVersion) => packageWithVersion.split('@')[0]!)
    }),
  )

const discoverUpdates = (target: string) =>
  Effect.withSpan('discoverUpdates', { attributes: { target } })(
    Effect.gen(function* () {
      yield* Console.log(`Discovering available updates (target: ${target})...`)

      const ncuCommand = `bunx npm-check-updates --deep --jsonUpgraded --packageManager pnpm${target !== 'latest' ? ` --target ${target}` : ''}`
      const ncuOutput = yield* cmdText(ncuCommand).pipe(
        Effect.catchAll((error) => Effect.fail(new Error(`Failed to run npm-check-updates: ${error}`))),
      )

      const validated = yield* Schema.decodeUnknown(Schema.parseJson(NCUOutput))(ncuOutput).pipe(
        Effect.mapError((error) => new Error(`Failed to parse NCU output: ${error}`)),
      )

      const totalUpdates = Object.values(validated).reduce((sum, updates) => sum + Object.keys(updates).length, 0)

      yield* Console.log(
        `Found ${totalUpdates} packages that can be updated across ${Object.keys(validated).length} package.json files`,
      )

      return validated
    }),
  )

const fetchExpoConstraints = () =>
  Effect.withSpan('fetchExpoConstraints')(
    Effect.gen(function* () {
      yield* Console.log('Fetching Expo SDK constraints...')

      // Get current Expo SDK version
      const expoVersion = yield* cmdText('pnpm view expo version').pipe(
        Effect.map((version) => version.trim().replace(/(\d+\.\d+)\.\d+/, '$1.0')),
        Effect.catchAll((error) => Effect.fail(new Error(`Failed to get Expo version: ${error}`))),
      )

      yield* Console.log(`Using Expo SDK: ${expoVersion}`)

      // Fetch constraints from Expo API
      const apiUrl = `https://api.expo.dev/v2/sdks/${expoVersion}/native-modules`
      const apiResponse = yield* HttpClient.get(apiUrl).pipe(
        Effect.andThen(HttpClientResponse.schemaBodyJson(ExpoApiResponse)),
        Effect.mapError((error) => new Error(`Failed to fetch Expo constraints: ${error}`)),
      )

      // Transform to package -> version mapping
      const constraints = apiResponse.data.reduce(
        (acc: Record<string, string>, item) => {
          acc[item.npmPackage] = item.versionRange
          return acc
        },
        {} as Record<string, string>,
      )

      const validated = yield* Schema.decodeUnknown(ExpoConstraints)(constraints)

      yield* Console.log(`Retrieved constraints for ${Object.keys(validated).length} Expo-managed packages`)

      return validated
    }),
  )

const applyExpoConstraints = (
  ncuOutput: typeof NCUOutput.Type,
  expoConstraints: typeof ExpoConstraints.Type,
  patchedDeps: readonly string[],
) =>
  Effect.withSpan('applyExpoConstraints')(
    Effect.gen(function* () {
      yield* Console.log('Applying Expo constraints to package updates...')

      const updates: Record<string, Record<string, string>> = {}
      let totalUpdates = 0
      let constrainedByExpo = 0
      let excludedByPatches = 0
      let excludedByDenyList = 0

      for (const [packageFile, packageUpdates] of Object.entries(ncuOutput)) {
        const finalUpdates: Record<string, string> = {}

        for (const [pkg, ncuVersion] of Object.entries(packageUpdates)) {
          // Skip dependencies in deny list
          if (DEPENDENCY_DENY_LIST.includes(pkg as any)) {
            excludedByDenyList++
            continue
          }

          // Skip patched dependencies
          if (patchedDeps.includes(pkg)) {
            excludedByPatches++
            continue
          }

          if (expoConstraints[pkg]) {
            // Use Expo constraint version instead of NCU version
            finalUpdates[pkg] = expoConstraints[pkg]
            constrainedByExpo++
          } else {
            // Use NCU suggested version
            finalUpdates[pkg] = ncuVersion
          }
          totalUpdates++
        }

        if (Object.keys(finalUpdates).length > 0) {
          updates[packageFile] = finalUpdates
        }
      }

      yield* Console.log(
        `Processing ${totalUpdates} package updates (${constrainedByExpo} constrained by Expo, ${excludedByPatches} excluded as patched, ${excludedByDenyList} excluded by deny list)`,
      )

      return updates
    }),
  )

const executeUpdates = (filteredUpdates: Record<string, Record<string, string>>, dryRun: boolean) =>
  Effect.withSpan('executeUpdates', { attributes: { dryRun } })(
    Effect.gen(function* () {
      const results: UpdateResult[] = []

      // Update all package.json files directly
      for (const [packageFile, updates] of Object.entries(filteredUpdates)) {
        if (Object.keys(updates).length === 0) continue

        const packageJsonPath = packageFile === 'package.json' ? './package.json' : `./${packageFile}`
        const packages = Object.entries(updates)
          .map(([pkg, version]) => `${pkg}@${version}`)
          .join(' ')

        yield* Console.log(`${dryRun ? '[DRY RUN] ' : ''}Updating ${packageJsonPath}: ${packages}`)

        if (!dryRun) {
          const updateResult = yield* Effect.gen(function* () {
            // Read current package.json
            const content = yield* Effect.try({
              try: () => fs.readFileSync(packageJsonPath, 'utf8'),
              catch: () => new Error(`Failed to read ${packageJsonPath}`),
            })

            const packageJson = yield* Effect.try({
              try: () => JSON.parse(content),
              catch: () => new Error(`Failed to parse ${packageJsonPath}`),
            })

            // Update dependencies in all sections
            for (const [pkg, version] of Object.entries(updates)) {
              if (packageJson.dependencies?.[pkg]) {
                packageJson.dependencies[pkg] = version
              }
              if (packageJson.devDependencies?.[pkg]) {
                packageJson.devDependencies[pkg] = version
              }
              if (packageJson.peerDependencies?.[pkg]) {
                packageJson.peerDependencies[pkg] = version
              }
            }

            // Write back to file with consistent formatting
            yield* Effect.try({
              try: () => fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`),
              catch: () => new Error(`Failed to write ${packageJsonPath}`),
            })

            return { success: true } as const
          }).pipe(
            Effect.withSpan(`updatePackageJson:${packageFile}`, { attributes: { packageFile } }),
            Effect.catchAll((error) => Effect.succeed({ success: false, error: String(error) } as const)),
          )

          results.push({
            packageFile,
            updates: Object.entries(updates).map(([name, targetVersion]) => ({
              name,
              currentVersion: 'unknown', // We'd need to track this separately
              targetVersion,
            })),
            ...updateResult,
          })
        }
      }

      // After all files updated, run pnpm install once to update lockfile
      if (!dryRun && Object.keys(filteredUpdates).length > 0) {
        yield* Console.log('Running pnpm install to update lockfile...')
        yield* cmd('pnpm install --fix-lockfile')
      }

      return results
    }),
  )

// Main command
export const updateDepsCommand = Cli.Command.make(
  'update-deps',
  {
    dryRun: Cli.Options.boolean('dry-run').pipe(
      Cli.Options.withDescription('Preview changes without executing updates'),
      Cli.Options.withDefault(false),
    ),
    target: Cli.Options.text('target').pipe(
      Cli.Options.withDescription('Update target: latest, minor, patch (default: minor)'),
      Cli.Options.withDefault('minor'),
    ),
    validate: Cli.Options.boolean('validate').pipe(
      Cli.Options.withDescription('Run validation after updates (default: true)'),
      Cli.Options.withDefault(true),
    ),
  },
  Effect.fn(function* ({ dryRun, target, validate }) {
    yield* Console.log('🔄 Starting dependency update workflow...')

    // Validate target option
    const validTargets = ['latest', 'minor', 'patch']
    if (!validTargets.includes(target)) {
      yield* Effect.fail(new Error(`Invalid target: ${target}. Must be one of: ${validTargets.join(', ')}`))
    }

    // Step 1: Read patched dependencies
    const patchedDeps = yield* readPatchedDependencies()
    if (patchedDeps.length > 0) {
      yield* Console.log(
        `Found ${patchedDeps.length} patched dependencies that will be excluded from updates: ${patchedDeps.join(', ')}`,
      )
    }
    if (DEPENDENCY_DENY_LIST.length > 0) {
      yield* Console.log(
        `Found ${DEPENDENCY_DENY_LIST.length} deny-listed dependencies that will be excluded from updates: ${DEPENDENCY_DENY_LIST.join(', ')}`,
      )
    }

    // Step 2: Discover available updates
    const ncuOutput = yield* discoverUpdates(target)

    // Step 3: Fetch Expo constraints
    const expoConstraints = yield* fetchExpoConstraints()

    // Step 4: Apply Expo constraints to all packages (excluding patched dependencies)
    const updates = yield* applyExpoConstraints(ncuOutput, expoConstraints, patchedDeps)

    // Step 5: Execute all updates
    if (Object.keys(updates).length > 0) {
      yield* executeUpdates(updates, dryRun)
    } else {
      yield* Console.log('No packages to update')
    }

    // Step 6: Validation (if not dry run and validate enabled)
    if (!dryRun && validate) {
      yield* Console.log('\n🔍 Running validation...')

      yield* cmd('syncpack lint').pipe(Effect.catchAll((error) => Console.warn(`Syncpack validation failed: ${error}`)))

      yield* cmd('syncpack fix-mismatches').pipe(
        Effect.catchAll((error) => Console.warn(`Syncpack fix failed: ${error}`)),
      )

      // Check Expo examples
      const expoExamples = yield* cmdText('find examples -name "expo" -type d -o -name "*expo*" -type d').pipe(
        Effect.map((output) => output.trim().split('\n').filter(Boolean)),
        Effect.catchAll(() => Effect.succeed([])),
      )

      for (const exampleDir of expoExamples) {
        yield* cmd('expo install --check', { cwd: exampleDir }).pipe(
          Effect.catchAll((error) => Console.warn(`Expo check failed for ${exampleDir}: ${error}`)),
        )
      }
    }

    yield* Console.log('✅ Dependency update workflow completed!')
  }),
)

if (import.meta.main) {
  const cli = Cli.Command.run(updateDepsCommand, {
    name: 'update-deps',
    version: '1.0.0',
  })

  const layer = Layer.mergeAll(PlatformNode.NodeContext.layer, FetchHttpClient.layer)

  cli(process.argv).pipe(
    Effect.annotateLogs({ thread: 'update-deps' }),
    Logger.withMinimumLogLevel(LogLevel.Info),
    Effect.provide(layer),
    PlatformNode.NodeRuntime.runMain,
  )
}
