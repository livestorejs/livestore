import path from 'node:path'

import { defineConfig } from 'vitest/config'

/**
 * Minimal vitest config for fast unit tests only.
 * Only includes packages that actually have test files.
 */

const rootDir = import.meta.dirname

// Only packages with actual test files (not all 24 @livestore packages)
const packagesWithTests = ['common', 'livestore', 'utils', 'webmesh']

export default defineConfig({
  test: {
    projects: [
      ...packagesWithTests.map((pkg) => path.join(rootDir, `packages/@livestore/${pkg}`)),
      path.join(rootDir, 'tests/package-common'),
    ],
  },
})
