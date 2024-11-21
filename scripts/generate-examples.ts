/* eslint-disable unicorn/no-process-exit */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import process from 'node:process'

import { BunContext, BunRuntime } from '@effect/platform-bun'
import { $ } from 'bun'
import { Effect, Schema } from 'effect'

import { BunShell, Cli } from './lib.js'

const workspaceRoot = process.env.WORKSPACE_ROOT
if (!workspaceRoot) {
  console.error('WORKSPACE_ROOT environment variable is not set')
  process.exit(1)
}

// Directories
const DIST_DIR = `${workspaceRoot}/examples/dist`
const PATCHES_DIR = `${workspaceRoot}/examples/patches`
const SRC_DIR = `${workspaceRoot}/examples/src`

$.cwd(workspaceRoot)

const checkDirs = Effect.gen(function* () {
  // Fails if dirs don't exist
  if (!fs.existsSync(PATCHES_DIR) || !fs.existsSync(SRC_DIR) || !fs.existsSync(DIST_DIR)) {
    console.error('Directories do not exist')
    process.exit(1)
  }
})

const SyncDirection = Schema.Literal('src-to-dist', 'dist-to-src')
type SyncDirection = typeof SyncDirection.Type

// Helper function to sync src to src-patched
const syncDirectories = (direction: SyncDirection) =>
  Effect.gen(function* () {
    if (direction === 'src-to-dist') {
      yield* BunShell.cmd(
        `rsync -a --delete --verbose --filter='dir-merge,- .gitignore' --exclude='.git' --exclude='README.md' ${SRC_DIR}/ ${DIST_DIR}/`,
      )

      // Apply patches
      const applyPatches = async (dir: string) => {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
          const fullPath = `${dir}/${entry.name}`
          if (entry.isDirectory()) {
            await applyPatches(fullPath)
          } else if (entry.isFile() && entry.name.endsWith('.patch')) {
            const relativePath = fullPath.replace(PATCHES_DIR, '').replace('.patch', '')
            const targetFile = `${DIST_DIR}${relativePath}`
            try {
              await $`patch -u ${targetFile} -i ${fullPath} --no-backup-if-mismatch`.nothrow()
              // console.log(`Applied patch: ${fullPath} to ${targetFile}`)
            } catch (error) {
              console.error(`Failed to apply patch ${fullPath}: ${error}`)
            }
          }
        }
      }

      yield* Effect.promise(() => applyPatches(PATCHES_DIR))

      console.log(`[${new Date().toISOString()}] Synced and patched ${SRC_DIR} to ${DIST_DIR}`)

      if (process.env.CI) {
        // Exit with error if there are any unstaged changes
        const status = yield* BunShell.cmdText(`git status --porcelain`)
        if (status !== '') {
          console.error('Unstaged changes detected', status)
          process.exit(1)
        }
      }
    } else {
      // Confirm before syncing from dist to src since this is destructive
      const answer = prompt(
        `Are you sure you want to sync from ${DIST_DIR} to ${SRC_DIR}? This will overwrite files in ${SRC_DIR}. (y/N) `,
      )

      if (answer?.toLowerCase() !== 'y') {
        console.log('Aborting sync')
        process.exit(0)
      }

      // From https://unix.stackexchange.com/a/168602
      // This tells rsync to look in each directory for a file .gitignore:
      // The `-n` after the `dir-merge,-` means that (`-`) the file specifies only excludes and (`n`) rules are not inherited by subdirectories.
      yield* BunShell.cmd(
        `rsync -a --delete --filter='dir-merge,- .gitignore' --exclude='.git' --exclude='README.md' ${DIST_DIR}/ ${SRC_DIR}/`,
      )

      // Reverse patches
      const reversePatches = async (dir: string) => {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
          const fullPath = `${dir}/${entry.name}`
          if (entry.isDirectory()) {
            await reversePatches(fullPath)
          } else if (entry.isFile() && entry.name.endsWith('.patch')) {
            const relativePath = fullPath.replace(PATCHES_DIR, '').replace('.patch', '')
            const targetFile = `${SRC_DIR}${relativePath}`
            try {
              await $`patch -R -u ${targetFile} -i ${fullPath} --no-backup-if-mismatch`.nothrow()
              // console.log(`Reversed patch: ${fullPath} from ${targetFile}`)
            } catch (error) {
              console.error(`Failed to reverse patch ${fullPath}: ${error}`)
            }
          }
        }
      }

      yield* Effect.promise(() => reversePatches(PATCHES_DIR))

      console.log(`[${new Date().toISOString()}] Synced and reversed patches from ${DIST_DIR} to ${SRC_DIR}`)
    }
  })

// Watchman configuration and commands
const setupWatchman = (direction: SyncDirection) =>
  Effect.gen(function* () {
    const watchDirs =
      direction === 'src-to-dist'
        ? [
            { dir: SRC_DIR, name: 'listen-src-changes' },
            { dir: PATCHES_DIR, name: 'listen-patches-changes' },
          ]
        : [
            { dir: DIST_DIR, name: 'listen-dist-changes' },
            { dir: PATCHES_DIR, name: 'listen-patch-changes' },
          ]

    for (const { dir, name } of watchDirs) {
      yield* BunShell.cmd(`watchman watch ${dir}`)
      console.log(`Set up watch on ${dir}`)

      // Subscribe to changes
      const subscriptionProcess = spawn('watchman', ['-j', '-p', '--no-pretty', '--output-encoding=json'], {
        stdio: ['pipe', 'pipe', 'inherit'],
      })

      subscriptionProcess.stdin.write(
        JSON.stringify([
          'subscribe',
          dir,
          name,
          {
            expression: ['allof', ['match', '**']],
            fields: ['name', 'size', 'mtime_ms', 'exists', 'type'],
          },
        ]),
      )
      subscriptionProcess.stdin.end()

      subscriptionProcess.stdout.on('data', (data) => {
        try {
          const changes = JSON.parse(data.toString())
          if (changes.files) {
            console.log(`Changes detected in ${dir}:`, changes.files.map((f: { name: string }) => f.name).join(', '))
            syncDirectories(direction)
          }
        } catch (error) {
          console.error(`Error parsing Watchman output: ${error}`)
        }
      })

      subscriptionProcess.on('error', (error) => {
        console.error(`Watchman process error for ${dir}:`, error)
      })

      subscriptionProcess.on('exit', (code) => {
        console.log(`Watchman process for ${dir} exited with code ${code}`)
      })
    }

    console.log(
      `Watchman setup complete. Listening for file changes in ${PATCHES_DIR} and ${direction === 'src-to-dist' ? SRC_DIR : DIST_DIR}...`,
    )
  })

const updatePatches = Effect.gen(function* () {
  yield* checkDirs

  yield* BunShell.cmd(`rm -rf ${PATCHES_DIR}`)

  const exampleDirs = fs.readdirSync(SRC_DIR).filter((item) => fs.statSync(`${SRC_DIR}/${item}`).isDirectory())
  const filesToPatch = ['package.json', 'tsconfig.json', 'vite.config.ts', 'vite.config.js', 'metro.config.js']
  for (const exampleDir of exampleDirs) {
    const patchDir = `${PATCHES_DIR}/${exampleDir}`
    yield* BunShell.cmd(`mkdir -p ${patchDir}`)

    for (const file of filesToPatch) {
      const distFile = `${DIST_DIR}/${exampleDir}/${file}`
      const srcFile = `${SRC_DIR}/${exampleDir}/${file}`
      const patchFile = `${patchDir}/${file}.patch`

      if (fs.existsSync(distFile) && fs.existsSync(srcFile)) {
        const diffResult = yield* BunShell.cmdTextNothrow(
          `diff -u --minimal --unidirectional-new-file --label=${file} --label=${file} ${srcFile} ${distFile}`,
        )
        if (diffResult === '') {
          console.log(`No changes detected for ${file} in ${exampleDir}`)
        } else {
          yield* Effect.promise(() => fs.promises.writeFile(patchFile, diffResult))
          console.log(`Updated patch for ${file} in ${exampleDir}`)
        }
      }
    }
  }
})

const syncExamples = ({ direction, watch }: { direction: SyncDirection; watch: boolean }) =>
  Effect.gen(function* () {
    yield* checkDirs

    if (watch === false) {
      yield* syncDirectories(direction)
    } else {
      yield* setupWatchman(direction)

      // Set up signal handlers for graceful shutdown
      const teardownWatchman = () =>
        Effect.gen(function* () {
          console.log('Tearing down Watchman...')
          yield* BunShell.cmd(`watchman shutdown-server`).pipe(Effect.ignoreLogged)
          console.log('Watchman teardown complete')
          process.exit(0)
        }).pipe(Effect.runFork)

      process.on('SIGTERM', teardownWatchman)
      process.on('SIGINT', teardownWatchman)

      // Keep the script running
      yield* Effect.never
    }
  })

const updatePatchesCommand = Cli.Command.make('update-patches', {}, () => updatePatches)
const syncExamplesCommand = Cli.Command.make(
  'sync',
  {
    direction: Cli.Options.text('direction').pipe(Cli.Options.withSchema(SyncDirection)),
    watch: Cli.Options.boolean('watch').pipe(Cli.Options.withDefault(false)),
  },
  syncExamples,
)

const command = Cli.Command.make('sync_examples').pipe(
  Cli.Command.withSubcommands([updatePatchesCommand, syncExamplesCommand]),
)

const cli = Cli.Command.run(command, {
  name: 'sync_examples',
  version: '0.0.1',
})

cli(process.argv).pipe(Effect.provide(BunContext.layer), BunRuntime.runMain)
