import solidPlugin from 'vite-plugin-solid'
import { defineConfig, type Plugin } from 'vitest/config'

export default defineConfig({
  plugins: [
    solidPlugin({
      hot: false,
      solid: { generate: 'dom' },
    }) as Plugin,
  ],
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
        inline: [/solid-js/],
      },
    },
  },
  resolve: {
    conditions: ['development', 'browser'],
  },
})
