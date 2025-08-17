import path from 'node:path'
import { defineConfig } from 'vitest/config'

const pkgDir = import.meta.dirname

export default defineConfig({
  test: {
    projects: [path.join(pkgDir, 'src/do-rpc/vitest.config.ts'), path.join(pkgDir, 'src/ws-rpc/vitest.config.ts')],
  },
})
