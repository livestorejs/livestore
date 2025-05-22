/* eslint-disable unicorn/no-process-exit */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import process from 'node:process'

import type { CommandExecutor } from '@livestore/utils/effect'
import { Effect, Runtime, Schema } from '@livestore/utils/effect'
import { Cli } from '@livestore/utils/node'
import { cmd, cmdText } from '@livestore/utils-dev/node'

const workspaceRoot = process.env.WORKSPACE_ROOT
if (!workspaceRoot) {
  console.error('WORKSPACE_ROOT environment variable is not set')
  process.exit(1)
}

// Directories
const STANDALONE_DIR = (workspaceRoot: string) => `${workspaceRoot}/examples/standalone`
const PATCHES_DIR = (workspaceRoot: string) => `${workspaceRoot}/examples/patches`
const SRC_DIR = (workspaceRoot: string) => `${workspaceRoot}/examples/src`

const EXCLUDE_EXAMPLES = ['node-effect-cli', 'node-todomvc-sync-cf']

const checkDirs = (workspaceRoot: string) =>
  Effect.gen(function* () {
    // Fails if dirs don't exist
    if (
      !fs.existsSync(PATCHES_DIR(workspaceRoot)) ||
      !fs.existsSync(SRC_DIR(workspaceRoot)) ||
      !fs.existsSync(STANDALONE_DIR(workspaceRoot))
    ) {
      console.error('Directories do not exist')
      process.exit(1)
    }
  })

const SyncDirection = Schema.Literal('src-to-standalone', 'standalone-to-src')
type SyncDirection = typeof SyncDirection.Type

// Helper function to sync src to src-patched
const syncDirectories = (direction: SyncDirection, workspaceRoot: string) =>
  Effect.gen(function* () {
    const excludeArgs = EXCLUDE_EXAMPLES.map((pattern) => `--exclude=${pattern}`)

    const runtime = yield* Effect.runtime<CommandExecutor.CommandExecutor>()

    if (direction === 'src-to-standalone') {
      yield* cmd(
        [
          'rsync',
          '-a',
          '--delete',
          '--verbose',
          `--filter=dir-merge,- .gitignore`,
          `--exclude=.git`,
          `--exclude=README.md`,
          ...excludeArgs,
          `${SRC_DIR(workspaceRoot)}/`,
          `${STANDALONE_DIR(workspaceRoot)}/`,
        ],
        { cwd: workspaceRoot },
      )

      // Apply patches
      const applyPatches = async (dir: string) => {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
          const fullPath = `${dir}/${entry.name}`
          if (entry.isDirectory()) {
            await applyPatches(fullPath)
          } else if (entry.isFile() && entry.name.endsWith('.patch')) {
            const relativePath = fullPath.replace(PATCHES_DIR(workspaceRoot), '').replace('.patch', '')
            const targetFile = `${STANDALONE_DIR(workspaceRoot)}${relativePath}`
            try {
              await cmd(`patch -u ${targetFile} -i ${fullPath} --no-backup-if-mismatch`, { cwd: workspaceRoot }).pipe(
                Runtime.runPromise(runtime),
              )
              // console.log(`Applied patch: ${fullPath} to ${targetFile}`)
            } catch (error) {
              console.error(`Failed to apply patch ${fullPath}: ${error}`)
            }
          }
        }
      }

      yield* Effect.promise(() => applyPatches(PATCHES_DIR(workspaceRoot)))

      console.log(
        `[${new Date().toISOString()}] Synced and patched ${SRC_DIR(workspaceRoot)} to ${STANDALONE_DIR(workspaceRoot)}`,
      )

      if (process.env.CI) {
        // Exit with error if there are any unstaged changes
        const status = yield* cmdText(`git status --porcelain`)
        if (status !== '') {
          console.error('Unstaged changes detected', status)
          process.exit(1)
        }
      }
    } else {
      // Confirm before syncing from standalone to src since this is destructive
      const answer = prompt(
        `Are you sure you want to sync from ${STANDALONE_DIR(workspaceRoot)} to ${SRC_DIR(workspaceRoot)}? This will overwrite files in ${SRC_DIR(workspaceRoot)}. (y/N) `,
      )

      if (answer?.toLowerCase() !== 'y') {
        console.log('Aborting sync')
        process.exit(0)
      }

      // From https://unix.stackexchange.com/a/168602
      // This tells rsync to look in each directory for a file .gitignore:
      // The `-n` after the `dir-merge,-` means that (`-`) the file specifies only excludes and (`n`) rules are not inherited by subdirectories.
      yield* cmd(
        [
          'rsync',
          '-a',
          '--delete',
          `--filter=dir-merge,- .gitignore`,
          `--exclude=.git`,
          `--exclude=README.md`,
          ...excludeArgs,
          `${STANDALONE_DIR(workspaceRoot)}/`,
          `${SRC_DIR(workspaceRoot)}/`,
        ],
        { cwd: workspaceRoot },
      )

      // Reverse patches
      const reversePatches = async (dir: string) => {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
          const fullPath = `${dir}/${entry.name}`
          if (entry.isDirectory()) {
            await reversePatches(fullPath)
          } else if (entry.isFile() && entry.name.endsWith('.patch')) {
            const relativePath = fullPath.replace(PATCHES_DIR(workspaceRoot), '').replace('.patch', '')
            const targetFile = `${SRC_DIR(workspaceRoot)}${relativePath}`
            try {
              await cmd(`patch -R -u ${targetFile} -i ${fullPath} --no-backup-if-mismatch`, {
                cwd: workspaceRoot,
              }).pipe(Runtime.runPromise(runtime))
              // console.log(`Reversed patch: ${fullPath} from ${targetFile}`)
            } catch (error) {
              console.error(`Failed to reverse patch ${fullPath}: ${error}`)
            }
          }
        }
      }

      yield* Effect.promise(() => reversePatches(PATCHES_DIR(workspaceRoot)))

      console.log(
        `[${new Date().toISOString()}] Synced and reversed patches from ${STANDALONE_DIR(workspaceRoot)} to ${SRC_DIR(workspaceRoot)}`,
      )
    }
  })

// Watchman configuration and commands
const setupWatchman = (direction: SyncDirection) =>
  Effect.gen(function* () {
    const watchDirs =
      direction === 'src-to-standalone'
        ? [
            { dir: SRC_DIR(workspaceRoot), name: 'listen-src-changes' },
            { dir: PATCHES_DIR(workspaceRoot), name: 'listen-patches-changes' },
          ]
        : [
            { dir: STANDALONE_DIR(workspaceRoot), name: 'listen-standalone-changes' },
            { dir: PATCHES_DIR(workspaceRoot), name: 'listen-patch-changes' },
          ]

    const runtime = yield* Effect.runtime<CommandExecutor.CommandExecutor>()

    for (const { dir, name } of watchDirs) {
      yield* cmd(`watchman watch ${dir}`, { cwd: workspaceRoot })
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
            syncDirectories(direction, workspaceRoot).pipe(Runtime.runPromise(runtime))
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
      `Watchman setup complete. Listening for file changes in ${PATCHES_DIR(workspaceRoot)} and ${direction === 'src-to-standalone' ? SRC_DIR : STANDALONE_DIR}...`,
    )
  })

export const updatePatchesCommand = Cli.Command.make(
  'update-patches',
  {
    workspaceRoot: Cli.Options.text('workspace-root').pipe(Cli.Options.withDefault(workspaceRoot)),
  },
  ({ workspaceRoot }) =>
    Effect.gen(function* () {
      yield* checkDirs(workspaceRoot)

      yield* cmd(`rm -rf ${PATCHES_DIR(workspaceRoot)}`, { cwd: workspaceRoot })

      const exampleDirs = fs
        .readdirSync(SRC_DIR(workspaceRoot))
        .filter((item) => fs.statSync(`${SRC_DIR(workspaceRoot)}/${item}`).isDirectory())
      const filesToPatch = [
        'package.json',
        'tsconfig.json',
        'vite.config.ts',
        'vite.config.js',
        'metro.config.js',
        'app.config.ts', // TanStack Start
      ]
      for (const exampleDir of exampleDirs) {
        const patchDir = `${PATCHES_DIR(workspaceRoot)}/${exampleDir}`
        yield* cmd(`mkdir -p ${patchDir}`, { cwd: workspaceRoot })

        for (const file of filesToPatch) {
          const distFile = `${STANDALONE_DIR(workspaceRoot)}/${exampleDir}/${file}`
          const srcFile = `${SRC_DIR(workspaceRoot)}/${exampleDir}/${file}`
          const patchFile = `${patchDir}/${file}.patch`

          if (fs.existsSync(distFile) && fs.existsSync(srcFile)) {
            const diffResult = yield* cmdText(
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
    }),
)

export const syncExamplesCommand = Cli.Command.make(
  'sync',
  {
    direction: Cli.Options.choice('direction', ['src-to-standalone', 'standalone-to-src']).pipe(
      Cli.Options.withSchema(SyncDirection),
    ),
    watch: Cli.Options.boolean('watch').pipe(Cli.Options.withDefault(false)),
    workspaceRoot: Cli.Options.text('workspace-root').pipe(Cli.Options.withDefault(workspaceRoot)),
  },
  ({ direction, watch, workspaceRoot }) =>
    Effect.gen(function* () {
      yield* checkDirs(workspaceRoot)

      const runtime = yield* Effect.runtime<CommandExecutor.CommandExecutor>()

      if (watch === false) {
        yield* syncDirectories(direction, workspaceRoot)
      } else {
        yield* setupWatchman(direction)

        // Set up signal handlers for graceful shutdown
        const teardownWatchman = () =>
          Effect.gen(function* () {
            console.log('Tearing down Watchman...')
            yield* cmd(`watchman shutdown-server`, { cwd: workspaceRoot }).pipe(Effect.ignoreLogged)
            console.log('Watchman teardown complete')
            process.exit(0)
          }).pipe(Runtime.runFork(runtime))

        process.on('SIGTERM', teardownWatchman)
        process.on('SIGINT', teardownWatchman)

        // Keep the script running
        yield* Effect.never
      }
    }),
)
