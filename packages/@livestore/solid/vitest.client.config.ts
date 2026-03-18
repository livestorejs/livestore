import solidPlugin from 'vite-plugin-solid'
import { defineConfig, type Plugin } from 'vitest/config'

export default defineConfig({
  plugins: [
    solidPlugin({
      hot: false,
      solid: { generate: 'dom' },
    }),
  ],
  server: {
    fs: {
      /** GVS (enableGlobalVirtualStore) stores packages in ~/Library/pnpm/store/
       * which is outside the project root. Vite blocks serving these by default. */
      strict: false,
    },
  },
  test: {
    root: import.meta.dirname,
    name: 'solid-client',
    watch: false,
    env: {
      NODE_ENV: 'production',
      SSR: '0',
      PROD: '1',
    },
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    globals: true,
    include: ['src/**/*.client.test.{ts,tsx}'],
    server: {
      deps: {
        /** solid-js removed from inline — with GVS, inlining creates a duplicate
         * module instance alongside the GVS-resolved one, triggering "multiple
         * instances of Solid" and breaking Suspense/signals. */
        inline: ['@effect/vitest'],
      },
    },
  },
  resolve: {
    conditions: ['development', 'browser'],
  },
})
