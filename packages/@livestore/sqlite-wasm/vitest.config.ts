import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: '@livestore/sqlite-wasm',
    include: ['src/**/*.test.ts'],
    poolOptions: {
      workers: {
        wrangler: {
          configPath: './wrangler.toml',
        },
        isolatedStorage: false,
        main: './src/test/setup.ts',
      },
    },
  },
})
