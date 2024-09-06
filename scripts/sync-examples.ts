/* eslint-disable unicorn/no-process-exit */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import process from 'node:process'

import { $ } from 'bun'

const cwd = process.cwd()

// Directories
const SRC_DIR = `${cwd}/examples`
const PATCHES_DIR = `${cwd}/patches/examples`
const DEST_DIR = `${cwd}/examples-monorepo`

// Fails if dirs don't exist
if (!fs.existsSync(SRC_DIR) || !fs.existsSync(PATCHES_DIR) || !fs.existsSync(DEST_DIR)) {
  console.error('Directories do not exist')
  process.exit(1)
}

// Helper function to sync src to src-patched
const syncDirectories = async (reverse: boolean = false) => {
  if (reverse) {
    // Reverse direction: patched-to-src
    await $`rsync -a --delete --filter='dir-merge,- .gitignore' ${DEST_DIR}/ ${SRC_DIR}/`

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

    await reversePatches(PATCHES_DIR)

    console.log(`[${new Date().toISOString()}] Synced and reversed patches from ${DEST_DIR} to ${SRC_DIR}`)
  } else {
    // From https://unix.stackexchange.com/a/168602
    // This tells rsync to look in each directory for a file .gitignore:
    // The `-n` after the `dir-merge,-` means that (`-`) the file specifies only excludes and (`n`) rules are not inherited by subdirectories.
    await $`rsync -a --delete --filter='dir-merge,- .gitignore' ${SRC_DIR}/ ${DEST_DIR}/`

    // Apply patches
    const applyPatches = async (dir: string) => {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = `${dir}/${entry.name}`
        if (entry.isDirectory()) {
          await applyPatches(fullPath)
        } else if (entry.isFile() && entry.name.endsWith('.patch')) {
          const relativePath = fullPath.replace(PATCHES_DIR, '').replace('.patch', '')
          const targetFile = `${DEST_DIR}${relativePath}`
          try {
            await $`patch -u ${targetFile} -i ${fullPath} --no-backup-if-mismatch`.nothrow()
            // console.log(`Applied patch: ${fullPath} to ${targetFile}`)
          } catch (error) {
            console.error(`Failed to apply patch ${fullPath}: ${error}`)
          }
        }
      }
    }

    await applyPatches(PATCHES_DIR)

    console.log(`[${new Date().toISOString()}] Synced and patched ${SRC_DIR} to ${DEST_DIR}`)
  }
}

// Watchman configuration and commands
const setupWatchman = async (reverse: boolean) => {
  const watchDirs = reverse
    ? [
        { dir: DEST_DIR, name: 'listen-dest-changes' },
        { dir: PATCHES_DIR, name: 'listen-patch-changes' },
      ]
    : [
        { dir: SRC_DIR, name: 'listen-example-changes' },
        { dir: PATCHES_DIR, name: 'listen-patch-changes' },
      ]

  for (const { dir, name } of watchDirs) {
    await $`watchman watch ${dir}`
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
          syncDirectories(reverse)
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
    `Watchman setup complete. Listening for file changes in ${PATCHES_DIR} and ${reverse ? SRC_DIR : DEST_DIR}...`,
  )
}

// Main function
const updatePatches = async () => {
  await $`rm -rf ${PATCHES_DIR}`

  const exampleDirs = fs.readdirSync(SRC_DIR).filter((item) => fs.statSync(`${SRC_DIR}/${item}`).isDirectory())
  const filesToPatch = ['package.json', 'tsconfig.json', 'vite.config.ts', 'vite.config.js', 'metro.config.js']
  for (const exampleDir of exampleDirs) {
    const patchDir = `${PATCHES_DIR}/${exampleDir}`
    await $`mkdir -p ${patchDir}`

    for (const file of filesToPatch) {
      const srcFile = `${SRC_DIR}/${exampleDir}/${file}`
      const destFile = `${DEST_DIR}/${exampleDir}/${file}`
      const patchFile = `${patchDir}/${file}.patch`

      if (fs.existsSync(srcFile) && fs.existsSync(destFile)) {
        const diffResult =
          await $`diff -u --minimal --unidirectional-new-file --label=${file} --label=${file} ${srcFile} ${destFile}`
            .nothrow()
            .text()
        if (diffResult === '') {
          console.log(`No changes detected for ${file} in ${exampleDir}`)
        } else {
          await fs.promises.writeFile(patchFile, diffResult)
          console.log(`Updated patch for ${file} in ${exampleDir}`)
        }
      }
    }
  }
}

const main = async () => {
  const workspaceRoot = process.env.WORKSPACE_ROOT
  if (!workspaceRoot) {
    console.error('WORKSPACE_ROOT environment variable is not set')
    process.exit(1)
  }

  process.chdir(workspaceRoot)

  const args = new Set(process.argv.slice(2))

  if (!fs.existsSync(DEST_DIR)) {
    fs.mkdirSync(DEST_DIR, { recursive: true })
  }

  const reverse = args.has('--reverse')

  if (args.has('--single-run')) {
    await syncDirectories(reverse)
  } else if (args.has('--watch')) {
    await setupWatchman(reverse)

    // Set up signal handlers for graceful shutdown
    const teardownWatchman = async () => {
      console.log('Tearing down Watchman...')
      await $`watchman shutdown-server`.nothrow()
      console.log('Watchman teardown complete')
      process.exit(0)
    }

    process.on('SIGTERM', teardownWatchman)
    process.on('SIGINT', teardownWatchman)

    // Keep the script running
    await new Promise(() => {})
  } else if (args.has('--update-patches')) {
    await updatePatches()
  } else {
    console.log('Usage: bun sync-examples.ts [--single-run | --watch | --update-patches]')
  }
}

// Run the main function
await main().catch((err) => {
  console.error(err)
  process.exit(1)
})
