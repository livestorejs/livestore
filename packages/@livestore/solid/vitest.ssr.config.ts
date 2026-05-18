import solidPlugin from 'vite-plugin-solid'
import { defineConfig, type Plugin } from 'vitest/config'

export default defineConfig({
  plugins: [
    solidPlugin({
      hot: false,
      solid: { generate: 'ssr' },
      ssr: true,
    }),
  ],
  test: {
    root: import.meta.dirname,
    name: 'solid-ssr',
    watch: false,
    env: {
      NODE_ENV: 'production',
      SSR: '1',
      PROD: '1',
    },
    environment: 'node',
    globals: true,
    include: ['src/**/*.server.test.{ts,tsx}'],
    server: { deps: { inline: ['@effect/vitest'] } },
  },
  resolve: {
    conditions: ['node'],
  },
  ssr: {
    resolve: {
      conditions: ['node'],
    },
  },
})
