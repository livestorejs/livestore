import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: ['./vitest-setup.ts'],
    testTimeout: 60000,
    // deps: {
    //   optimizer: {
    //     ssr: {
    //       enabled: true,
    //       include: ['@livestore/utils/effect'],
    //     },
    //   },
    // },
  },
})
