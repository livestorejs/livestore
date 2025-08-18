import path from 'node:path'
import { defineConfig } from 'vitest/config'

const pkgDir = import.meta.dirname

export default defineConfig({
  test: {
    setupFiles: [
      path.join(pkgDir, 'src/do-rpc/test-fixtures/vitest-setup.ts'),
      path.join(pkgDir, 'src/ws-rpc/test-fixtures/vitest-setup.ts'),
    ],
  },
})
