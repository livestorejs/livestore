import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { defineConfig } from 'vitest/config'

const packageRoot = import.meta.dirname
const workspaceRoot = path.resolve(packageRoot, '../..')

const loadTestEnv = () => {
  const localEnvFile = path.join(packageRoot, '.env.test.local')
  if (fs.existsSync(localEnvFile) === true) {
    process.loadEnvFile(localEnvFile)
  }
  process.loadEnvFile(path.join(packageRoot, '.env.test'))

  return {
    WORKSPACE_ROOT: process.env.WORKSPACE_ROOT ?? workspaceRoot,
  }
}

export default defineConfig({
  test: {
    env: loadTestEnv(),
    testTimeout: 60000,
    include: ['src/**/*.test.ts'],
    server: { deps: { inline: ['@effect/vitest'] } },
  },
})
