import { defineConfig } from 'vite'

export default defineConfig({
  test: {
    // Needed for React hook tests
    environment: 'jsdom',
  },
  resolve: {
    alias: {
      'sqlite-esm': 'sqlite-esm/node',
    },
  },
})
