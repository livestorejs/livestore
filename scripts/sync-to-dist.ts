#!/usr/bin/env bun

/**
 * LiveStore Distribution Sync CLI - Enhanced Effect Version
 *
 * Syncs LiveStore source packages to a clean distribution directory that can be
 * referenced by external projects using pnpm file protocol overrides. This enables
 * seamless live reloading when developing LiveStore in the context of external
 * projects like bug repos without the limitations of pnpm link.
 *
 * Usage:
 *   bun scripts/sync-to-dist.ts [--dist <path>] [--patch-target <path>] [--watch]
 *
 * Examples:
 *   bun scripts/sync-to-dist.ts                              # Uses default ../livestore-dist
 *   bun scripts/sync-to-dist.ts --dist ../my-dist            # Custom distribution directory
 *   bun scripts/sync-to-dist.ts --patch-target ../bug-repo   # Sync + patch target project
 *   bun scripts/sync-to-dist.ts --watch                      # Default dist with watching
 *   bun scripts/sync-to-dist.ts --dist ../my-dist --patch-target ../bug-repo --watch # All options
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  Chunk,
  Command,
  Effect,
  FileSystem,
  Layer,
  Logger,
  LogLevel,
  Option,
  pipe,
  Stream,
} from '@livestore/utils/effect'
import { Cli, PlatformNode } from '@livestore/utils/node'
import * as ParcelWatcher from '@parcel/watcher'

const REPO_ROOT = resolve(process.cwd())
const PACKAGES_DIR = join(REPO_ROOT, 'packages', '@livestore')

interface DistSyncInfo {
  sourceDir: string
  targetDir: string
}

const EXCLUDED_ITEMS = [
  'node_modules',
  '.git',
  '*.log',
  '.DS_Store',
  'tsconfig.tsbuildinfo',
  '.tsbuildinfo',
  '*.tsbuildinfo',
  '.tsbuildinfo.json',
  '*.tmp',
  '*.swp',
  '*.swo',
  '.vscode',
  '.idea',
]

const validateTarget = (targetPath: string) =>
  Effect.gen(function* () {
    const absolutePath = resolve(targetPath)

    // Create target directory if it doesn't exist
    if (!existsSync(absolutePath)) {
      yield* Effect.log(`Creating target directory: ${absolutePath}`)
      yield* Effect.try({
        try: () => {
          const fs = require('node:fs')
          fs.mkdirSync(absolutePath, { recursive: true })
        },
        catch: (error) => `Failed to create target directory: ${error}`,
      })
    }

    // Verify we can write to the directory
    yield* Effect.try({
      try: () => {
        const fs = require('node:fs')
        fs.accessSync(absolutePath, fs.constants.W_OK)
      },
      catch: (error) => `Target directory is not writable: ${error}`,
    })

    return absolutePath
  }).pipe(Effect.withSpan('validate-target', { attributes: { targetPath } }))

const validatePatchTarget = (patchTargetPath: string) =>
  Effect.gen(function* () {
    const absolutePath = resolve(patchTargetPath)

    // Check if directory exists
    if (!existsSync(absolutePath)) {
      return yield* Effect.fail(`Patch target directory does not exist: ${absolutePath}`)
    }

    // Check if it's a directory
    yield* Effect.try({
      try: () => {
        const fs = require('node:fs')
        const stats = fs.statSync(absolutePath)
        if (!stats.isDirectory()) {
          throw new Error('Not a directory')
        }
      },
      catch: (error) => `Patch target is not a directory: ${error}`,
    })

    // Check if package.json exists
    const packageJsonPath = join(absolutePath, 'package.json')
    if (!existsSync(packageJsonPath)) {
      return yield* Effect.fail(`No package.json found in patch target: ${packageJsonPath}`)
    }

    // Verify we can read and write the package.json
    yield* Effect.try({
      try: () => {
        const fs = require('node:fs')
        fs.accessSync(packageJsonPath, fs.constants.R_OK | fs.constants.W_OK)
      },
      catch: (error) => `Cannot read/write package.json: ${error}`,
    })

    yield* Effect.log(`Patch target validated: ${absolutePath}`)
    return absolutePath
  }).pipe(Effect.withSpan('validate-patch-target', { attributes: { patchTargetPath } }))

const createDistSyncInfo = (targetDir: string) =>
  Effect.gen(function* () {
    yield* Effect.log('Preparing distribution directory sync...')

    // Verify source directory exists
    if (!existsSync(PACKAGES_DIR)) {
      return yield* Effect.fail(`LiveStore packages directory not found: ${PACKAGES_DIR}`)
    }

    // Count available packages
    const packageDirs = yield* Effect.try({
      try: () =>
        readdirSync(PACKAGES_DIR, { withFileTypes: true })
          .filter((item) => item.isDirectory())
          .map((item) => item.name),
      catch: (error) => `Error reading packages directory: ${error}`,
    })

    yield* Effect.log(`Found ${packageDirs.length} LiveStore packages to sync`)
    packageDirs.forEach((pkg) => console.log(`  - @livestore/${pkg}`))

    return {
      sourceDir: PACKAGES_DIR,
      targetDir,
    } satisfies DistSyncInfo
  }).pipe(Effect.withSpan('create-dist-sync-info'))

const generatePnpmOverrides = (distPath: string) =>
  Effect.gen(function* () {
    yield* Effect.log('Generating pnpm overrides for distribution packages...')

    // Get all packages in the distribution directory
    const packageDirs = yield* Effect.try({
      try: () =>
        readdirSync(distPath, { withFileTypes: true })
          .filter((item) => item.isDirectory())
          .map((item) => item.name),
      catch: (error) => `Error reading distribution directory: ${error}`,
    })

    // Generate overrides mapping
    const overrides: Record<string, string> = {}
    for (const pkg of packageDirs) {
      const packagePath = join(distPath, pkg)
      const packageJsonPath = join(packagePath, 'package.json')

      // Only include if it has a package.json (valid package)
      if (existsSync(packageJsonPath)) {
        overrides[`@livestore/${pkg}`] = `file:${packagePath}`
      }
    }

    yield* Effect.log(`Generated ${Object.keys(overrides).length} pnpm overrides`)
    Object.entries(overrides).forEach(([name, path]) => console.log(`  - ${name}: ${path}`))

    return overrides
  }).pipe(Effect.withSpan('generate-pnpm-overrides', { attributes: { distPath } }))

const updatePackageJsonWithOverrides = (patchTargetPath: string, overrides: Record<string, string>) =>
  Effect.gen(function* () {
    const packageJsonPath = join(patchTargetPath, 'package.json')

    yield* Effect.log(`Updating package.json with pnpm overrides: ${packageJsonPath}`)

    // Read existing package.json
    const packageJsonContent = yield* Effect.try({
      try: () => readFileSync(packageJsonPath, 'utf-8'),
      catch: (error) => `Failed to read package.json: ${error}`,
    })

    // Parse JSON
    const packageJson = yield* Effect.try({
      try: () => JSON.parse(packageJsonContent),
      catch: (error) => `Failed to parse package.json: ${error}`,
    })

    // Update pnpm overrides
    if (!packageJson.pnpm) {
      packageJson.pnpm = {}
    }
    packageJson.pnpm.overrides = overrides

    // Write back to file
    const updatedContent = JSON.stringify(packageJson, null, 2)
    yield* Effect.try({
      try: () => {
        const fs = require('node:fs')
        fs.writeFileSync(packageJsonPath, updatedContent)
      },
      catch: (error) => `Failed to write package.json: ${error}`,
    })

    yield* Effect.log(`Successfully updated package.json with ${Object.keys(overrides).length} overrides`)
  }).pipe(
    Effect.withSpan('update-package-json-with-overrides', {
      attributes: { patchTargetPath, overrideCount: Object.keys(overrides).length },
    }),
  )

const runPnpmInstall = (patchTargetPath: string) =>
  Effect.gen(function* () {
    yield* Effect.log(`Running pnpm install in patch target: ${patchTargetPath}`)

    yield* Command.make('pnpm', 'install').pipe(
      Command.workingDirectory(patchTargetPath),
      Command.exitCode,
      Effect.flatMap((exitCode) => {
        if (exitCode === 0) {
          return Effect.log('pnpm install completed successfully')
        } else {
          return Effect.fail(`pnpm install failed with exit code ${exitCode}`)
        }
      }),
      Effect.catchAll((error) => Effect.logError(`Error running pnpm install: ${error}`)),
    )
  }).pipe(Effect.withSpan('run-pnpm-install', { attributes: { patchTargetPath } }))

const syncToDistDirectory = (syncInfo: DistSyncInfo) =>
  Effect.gen(function* () {
    yield* Effect.log(`Syncing LiveStore packages to distribution directory: ${syncInfo.targetDir}`)

    // Build rsync command with exclusions
    const excludeArgs = EXCLUDED_ITEMS.flatMap((pattern) => ['--exclude', pattern])

    const rsyncArgs = [
      '-av', // archive mode, verbose
      '--delete', // delete files in target that don't exist in source
      '--exclude',
      'node_modules', // Always exclude node_modules
      ...excludeArgs,
      `${syncInfo.sourceDir}/`, // Source directory (trailing slash important)
      `${syncInfo.targetDir}/`, // Target directory
    ]

    yield* Command.make('rsync', ...rsyncArgs).pipe(
      Command.exitCode,
      Effect.flatMap((exitCode) => {
        if (exitCode === 0) {
          return Effect.log(`Successfully synced LiveStore packages to: ${syncInfo.targetDir}`)
        } else {
          return Effect.fail(`rsync failed with exit code ${exitCode}`)
        }
      }),
      Effect.catchAll((error) => Effect.logError(`Error syncing to distribution directory: ${error}`)),
    )

    yield* Effect.log('Distribution sync completed!')
  }).pipe(
    Effect.withSpan('sync-to-dist-directory', {
      attributes: {
        sourceDir: syncInfo.sourceDir,
        targetDir: syncInfo.targetDir,
      },
    }),
  )

const extractPackageFromPath = (filePath: string): Option.Option<string> => {
  const match = filePath.match(/packages\/@livestore\/([^/]+)/)
  return match?.[1] ? Option.some(match[1]) : Option.none()
}

const isRelevantChange = (filePath: string): boolean => {
  // Skip if path contains excluded patterns
  return !EXCLUDED_ITEMS.some((pattern) => {
    if (pattern.includes('*')) {
      const regex = new RegExp(pattern.replace(/\*/g, '.*'))
      return regex.test(filePath)
    }
    return filePath.includes(pattern)
  })
}

// API-compatible FileSystem.watch implementation using @parcel/watcher
// until Effect supports recursive watching (https://github.com/Effect-TS/effect/issues/2986)
const createParcelWatchStream = (directoryPath: string) =>
  Stream.async<{ _tag: string; path: string }, string>((emit) => {
    let subscription: any // ParcelWatcher.AsyncSubscription type not exported

    // Start the parcel watcher
    const startWatcher = async () => {
      try {
        subscription = await ParcelWatcher.subscribe(
          directoryPath,
          (err: Error | null, events: Array<{ type: string; path: string }>) => {
            if (err) {
              emit.fail(`Parcel watcher error: ${err}`)
              return
            }

            // Convert parcel watcher events to Effect FileSystem.watch compatible format
            for (const event of events) {
              emit.single({
                _tag: event.type, // 'create', 'update', 'delete'
                path: event.path,
              })
            }
          },
        )
      } catch (error) {
        emit.fail(`Failed to start parcel watcher: ${error}`)
      }
    }

    // Cleanup function
    const cleanup = () => {
      if (subscription && typeof subscription.unsubscribe === 'function') {
        subscription.unsubscribe()
        subscription = undefined
      }
    }

    // Start the watcher
    startWatcher()

    // Return cleanup function
    return Effect.sync(cleanup)
  })

const createFileWatchStream = (syncInfo: DistSyncInfo) =>
  pipe(
    // Use API-compatible @parcel/watcher implementation for recursive watching support
    // TODO: Switch to Effect's native FileSystem.watch once recursive watching is supported
    // See: https://github.com/Effect-TS/effect/issues/2986
    createParcelWatchStream(PACKAGES_DIR),
    // Filter relevant events
    Stream.filter((event) => isRelevantChange(event.path)),
    Stream.tapLogWithLabel('file'),
    // Debounce rapid changes
    Stream.debounce('300 millis'),
    // Log detected changes with event type
    Stream.tap((event) => {
      const packageNameOpt = extractPackageFromPath(event.path)
      const packageName = Option.isSome(packageNameOpt) ? packageNameOpt.value : 'unknown'
      const relativePath = event.path.split(`packages/@livestore/${packageName}/`)[1] || event.path
      return Effect.log(`${event._tag} detected in @livestore/${packageName}: ${relativePath}`)
    }),
    // Trigger distribution sync for any change
    Stream.mapEffect(() => syncToDistDirectory(syncInfo)),
    // Handle any sync errors gracefully
    Stream.catchAll((error) => Stream.fromEffect(Effect.logError(`Watch stream error`, error))),
  )

const watchMode = (syncInfo: DistSyncInfo) =>
  Effect.gen(function* () {
    yield* Effect.log('Starting enhanced watch mode...')
    yield* Effect.log('Press Ctrl+C to stop watching')
    yield* Effect.log(`Watching ${PACKAGES_DIR} for changes...`)

    // Run the stream with proper interruption support
    yield* Stream.runDrain(createFileWatchStream(syncInfo))
  }).pipe(
    Effect.withSpan('enhanced-watch-mode'),
    Effect.interruptible, // Allows clean interruption with Ctrl+C
  )

export const command = Cli.Command.make(
  'sync-to-dist',
  {
    dist: Cli.Options.text('dist').pipe(Cli.Options.withDefault('../livestore-dist')),
    patchTarget: Cli.Options.text('patch-target').pipe(Cli.Options.optional),
    watch: Cli.Options.boolean('watch').pipe(Cli.Options.withDefault(false)),
  },
  Effect.fn(function* ({ dist, patchTarget, watch }) {
    yield* Effect.log('LiveStore Distribution Sync CLI')

    // Validate distribution directory
    const validatedDistPath = yield* validateTarget(dist)
    yield* Effect.log(`Distribution directory validated: ${validatedDistPath}`)

    // Create distribution sync info
    const syncInfo = yield* createDistSyncInfo(validatedDistPath)

    // Initial sync to distribution
    yield* syncToDistDirectory(syncInfo)

    // Handle patch target if provided
    if (Option.isSome(patchTarget)) {
      const patchTargetPath = patchTarget.value
      yield* Effect.log(`Patching target project: ${patchTargetPath}`)

      // Validate patch target
      const validatedPatchTarget = yield* validatePatchTarget(patchTargetPath)

      // Generate pnpm overrides for the distribution
      const overrides = yield* generatePnpmOverrides(validatedDistPath)

      // Update package.json with overrides
      yield* updatePackageJsonWithOverrides(validatedPatchTarget, overrides)

      // Run pnpm install
      yield* runPnpmInstall(validatedPatchTarget)

      yield* Effect.log('Patch target setup completed!')
    }

    // Watch mode
    if (watch) {
      // TODO: In watch mode, we need to re-run pnpm install when patch target is specified
      yield* watchMode(syncInfo)
    } else {
      yield* Effect.log('Tip: Use --watch to automatically sync changes')
    }
  }),
)

// Check if this is the main module (compatible with Bun and Node)
if (typeof process !== 'undefined' && process.argv[1] && process.argv[1].endsWith('sync-to-dist.ts')) {
  const cli = Cli.Command.run(command, {
    name: 'LiveStore Distribution Sync',
    version: '0.1.0',
  })

  cli(process.argv).pipe(
    Logger.withMinimumLogLevel(LogLevel.Debug),
    Effect.provide(Logger.pretty),
    Effect.provide(PlatformNode.NodeContext.layer),
    PlatformNode.NodeRuntime.runMain,
  )
}
