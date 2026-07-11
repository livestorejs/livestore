import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { defineConfig } from 'vite-plus'

/*
NOTE we're mapping to absolute paths here to avoid issues where tests seem to be resolved multiple times leading to duplicates
*/

const rootDir = import.meta.dirname
const resolveProjectPath = (packageDir: string): string | undefined => {
  const rootConfig = path.join(packageDir, 'vitest.config.ts')
  if (fs.existsSync(rootConfig) === true) {
    return rootConfig
  }

  const testsConfig = path.join(packageDir, 'tests/vitest.config.ts')
  if (fs.existsSync(testsConfig) === true) {
    return testsConfig
  }

  return undefined
}

const rootPackages = fs
  .readdirSync(path.join(rootDir, './packages/@livestore'))
  .filter((dir) => fs.statSync(path.join(rootDir, './packages/@livestore', dir)).isDirectory())
  .map((dir) => resolveProjectPath(path.join(rootDir, './packages/@livestore', dir)))
  .filter((projectPath): projectPath is string => projectPath !== undefined)

const loadTestEnv = () => {
  const localEnvFile = path.join(rootDir, '.env.test.local')
  if (fs.existsSync(localEnvFile) === true) {
    process.loadEnvFile(localEnvFile)
  }
  process.loadEnvFile(path.join(rootDir, '.env.test'))

  return {
    WORKSPACE_ROOT: process.env.WORKSPACE_ROOT ?? rootDir,
  }
}

export default defineConfig({
  test: {
    env: loadTestEnv(),
    projects: [
      ...rootPackages,
      path.join(rootDir, 'packages/@local/astro-twoslash-code/vitest.config.ts'),
      path.join(rootDir, 'packages/@local/astro-tldraw/vitest.config.ts'),
      path.join(rootDir, 'tests/package-common/vitest.config.ts'),
    ],
    server: { deps: { inline: ['@effect/vitest'] } },
  },
})
