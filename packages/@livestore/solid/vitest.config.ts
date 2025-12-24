import solidPlugin from 'vite-plugin-solid'
import { defineConfig } from 'vitest/config'

export default defineConfig(({ mode }) => {
  // To test in server environment, run with "--mode ssr" flag
  // Following pattern from https://github.com/solidjs-community/solid-lib-starter
  const testSSR = mode === 'ssr' || mode === 'test:ssr'

  return {
    plugins: [
      solidPlugin({
        // https://github.com/solidjs/solid-refresh/issues/29
        hot: false,
        // For testing SSR we need to do a SSR JSX transform
        solid: { generate: testSSR ? 'ssr' : 'dom' },
      }),
    ],
    test: {
      watch: false,
      isolate: !testSSR,
      env: {
        NODE_ENV: testSSR ? 'production' : 'development',
        DEV: testSSR ? '' : '1',
        SSR: testSSR ? '1' : '',
        PROD: testSSR ? '1' : '',
      },
      // Both modes use node environment for WASM compatibility
      // Client mode gets jsdom globals via setup.ts (same as React tests)
      environment: 'node',
      setupFiles: testSSR ? [] : ['./test/setup.ts'],
      globals: true,
      transformMode: { web: [/\.[jt]sx$/] },
      // SSR mode: only run *.server.test.* files
      // Client mode: only run *.client.test.* files
      ...(testSSR ? { include: ['src/**/*.server.test.{ts,tsx}'] } : { include: ['src/**/*.client.test.{ts,tsx}'] }),
    },
    esbuild: {
      // TODO remove once `using` keyword supported OOTB with Vite https://github.com/vitejs/vite/issues/15464#issuecomment-1872485703
      target: 'es2020',
    },
    resolve: {
      conditions: testSSR ? ['node'] : ['browser', 'development'],
      alias: {
        // Use node WASM loader for compatibility
        '@livestore/wa-sqlite/dist/wa-sqlite.mjs': '@livestore/wa-sqlite/dist/wa-sqlite.node.mjs',
      },
    },
  }
})
