import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: '@livestore/sqlite-wasm',
    root: import.meta.dirname,
    include: ['src/**/*.test.ts'],
    // TODO(#1358): Migrate this removed Vitest 4 config shape.
    poolOptions: {
      workers: {
        wrangler: {
          configPath: './wrangler.toml',
        },
        isolatedStorage: false,
        main: './src/test/setup.ts',
      },
    },
    server: { deps: { inline: ['@effect/vitest'] } },
  },
})
