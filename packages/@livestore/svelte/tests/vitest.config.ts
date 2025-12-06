import { fileURLToPath } from 'node:url'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { svelteTesting } from '@testing-library/svelte/vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  test: {
    name: '@livestore/svelte',
    environment: 'jsdom',
    clearMocks: true,
    include: ['**/*.svelte.{test,spec}.{js,ts}', '**/*.{test,spec}.{js,ts}'],
    setupFiles: [fileURLToPath(new URL('./vitest-setup-client.ts', import.meta.url))],
  },
  plugins: [
    svelte({
      // Skip looking for a package-level Svelte config to avoid noisy warnings in tests
      configFile: false,
    }),
    svelteTesting(),
  ],
  resolve: {
    conditions: ['svelte'],
  },
})
