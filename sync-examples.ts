import fs from 'node:fs'

import { $ } from 'bun'

// Directories
const SRC_DIR = 'examples'
const PATCHES_DIR = 'examples-monorepo/patches'
const DEST_DIR = 'examples-monorepo/examples'

// Helper function to sync src to src-patched
const syncDirectories = async () => {
  await $`rsync -a --delete ${SRC_DIR}/ ${DEST_DIR}/`

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
          await $`patch -u ${targetFile} -i ${fullPath}`.nothrow()
          console.log(`Applied patch: ${fullPath} to ${targetFile}`)
        } catch (error) {
          console.error(`Failed to apply patch ${fullPath}: ${error}`)
        }
      }
    }
  }

  await applyPatches(PATCHES_DIR)

  console.log(`[${new Date().toISOString()}] Synced and patched ${SRC_DIR} to ${DEST_DIR}`)
}

// Watchman configuration and commands
const setupWatchman = async () => {
  await $`watchman watch ${SRC_DIR}`
  await $`watchman watch ${PATCHES_DIR}`

  const triggerCommand = `
    watchman -j <<-EOT
    ["trigger", "${SRC_DIR}", {
      "name": "sync",
      "expression": ["allof", ["match", "*"]],
      "command": ["bun", "sync.ts", "--single-run"]
    }]
    EOT
  `
  await $`${triggerCommand}`

  const triggerCommandPatches = `
    watchman -j <<-EOT
    ["trigger", "${PATCHES_DIR}", {
      "name": "sync-patches",
      "expression": ["allof", ["match", "*"]],
      "command": ["bun", "sync.ts", "--single-run"]
    }]
    EOT
  `
  await $`${triggerCommandPatches}`
}

// Main function
const updatePatches = async () => {
  await $`rm -rf ${PATCHES_DIR}`

  const exampleDirs = fs.readdirSync(SRC_DIR).filter((item) => fs.statSync(`${SRC_DIR}/${item}`).isDirectory())
  const filesToPatch = ['package.json', 'tsconfig.json', 'vite.config.ts', 'vite.config.js']
  for (const exampleDir of exampleDirs) {
    const patchDir = `${PATCHES_DIR}/${exampleDir}`
    await $`mkdir -p ${patchDir}`

    for (const file of filesToPatch) {
      const srcFile = `${SRC_DIR}/${exampleDir}/${file}`
      const destFile = `${DEST_DIR}/${exampleDir}/${file}`
      const patchFile = `${patchDir}/${file}.patch`

      if (fs.existsSync(srcFile) && fs.existsSync(destFile)) {
        const diffResult = await $`diff -u ${srcFile} ${destFile}`.nothrow().text()
        if (diffResult !== '') {
          await fs.promises.writeFile(patchFile, diffResult)
          console.log(`Updated patch for ${file} in ${exampleDir}`)
        }
      }
    }
  }
}

const main = async () => {
  const args = new Set(process.argv.slice(2))

  if (!fs.existsSync(DEST_DIR)) {
    fs.mkdirSync(DEST_DIR, { recursive: true })
  }

  if (args.has('--single-run')) {
    await syncDirectories()
  } else if (args.has('--watch')) {
    await setupWatchman()
    console.log('Watching for changes...')
  } else if (args.has('--update-patches')) {
    await updatePatches()
  } else {
    console.log('Usage: bun sync.ts [--single-run | --watch | --update-patches]')
  }
}

// Run the main function
await main().catch((err) => {
  console.error(err)
  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(1)
})
