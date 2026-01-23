import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      /**
       * @standard-schema/spec is re-exported by @livestore/utils but not directly imported here.
       * In pnpm strict mode, it's isolated to utils's node_modules, so Vite can't resolve it.
       * This alias points to the actual location without adding a phantom devDependency.
       */
      '@standard-schema/spec': path.join(
        import.meta.dirname,
        '../../../packages/@livestore/utils/node_modules/@standard-schema/spec',
      ),
    },
  },
  test: {
    name: '@livestore/cli',
    root: import.meta.dirname,
    include: ['src/**/*.test.ts'],
  },
})
