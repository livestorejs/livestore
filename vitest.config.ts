import fs from 'node:fs'
import path from 'node:path'

import { defineConfig } from 'vitest/config'

/*
NOTE we're mapping to absolute paths here to avoid issues where tests seem to be resolved multiple times leading to duplicates
*/

const rootDir = import.meta.dirname
const rootPackages = fs
  .readdirSync(path.join(rootDir, './packages/@livestore'))
  .filter((dir) => fs.statSync(path.join(rootDir, './packages/@livestore', dir)).isDirectory())
  .map((dir) => path.join(rootDir, './packages/@livestore', dir))

export default defineConfig({
  test: {
    projects: [
      ...rootPackages,
      // path.join(rootDir, 'tests/'),
      path.join(rootDir, 'tests/integration/src/tests/node-sync/vitest.config.ts'),
      path.join(rootDir, 'tests/integration/src/tests/node-misc/vitest.config.ts'),
      path.join(rootDir, 'tests/sync-provider/vitest.config.ts'),
      path.join(rootDir, 'tests/package-common'),
      path.join(rootDir, 'tests/wa-sqlite/vitest.config.ts'),
    ],
  },
})
