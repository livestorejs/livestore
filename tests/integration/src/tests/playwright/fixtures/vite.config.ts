import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

import { type DepOptimizationOptions, type Plugin, defineConfig } from 'vite'

import { livestoreDevtoolsPlugin } from '@livestore/devtools-vite'

const TEST_LIVESTORE_SCHEMA_PATH_JSON = process.env.TEST_LIVESTORE_SCHEMA_PATH_JSON

// https://vitejs.dev/config
export default defineConfig(async () => {
  const entry = process.env.LIVESTORE_DEVTOOLS_VITE_ENTRY
  const versionSkew = process.env.LIVESTORE_TEST_DEVTOOLS_VERSION_SKEW === '1'
  // The verified artifact entry is selected at runtime by the DevTools suite.
  const plugin: typeof livestoreDevtoolsPlugin =
    entry === undefined ? livestoreDevtoolsPlugin : (await import(pathToFileURL(entry).href)).livestoreDevtoolsPlugin
  return {
    server: {
      host: '0.0.0.0',
      fs: { strict: false },
    },
    root: import.meta.dirname,
    optimizeDeps: {
      // Pre-bundle dependencies from entry points to avoid Vite's dependency optimization during
      // tests which causes page reloads and React duplicate issues (Invalid hook call errors).
      esbuildOptions: versionSkew === true ? versionSkewOptimizerOptions : undefined,
      entries: ['./main.tsx', './devtools/**/*.tsx'],
      // TODO remove @livestore/wa-sqlite once fixed https://github.com/vitejs/vite/issues/8427
      // TODO figure out why `fsevents` is needed. Otherwise seems to throw error when starting Vite
      // Error: `No loader is configured for ".node" files`
      exclude: [
        '@livestore/wa-sqlite',
        'fsevents',
        'playwright-core', // Needed to avoid (https://share.cleanshot.com/z92cVCVD)
        'lightningcss', // Needed to avoid (https://share.cleanshot.com/DtKNwNcQ)
      ],
    },
    worker: { plugins: () => (versionSkew === true ? [versionSkewPlugin()] : []) },
    plugins: [
      versionSkew === true ? versionSkewPlugin() : undefined,
      TEST_LIVESTORE_SCHEMA_PATH_JSON !== undefined
        ? plugin({ schemaPath: JSON.parse(TEST_LIVESTORE_SCHEMA_PATH_JSON) })
        : undefined,
    ],
  }
})

// Deliberately unlike any released artifact, without changing the DevTools protocol.
// Apply to the app AND its real workers: a page-only override cannot exercise the
// exact-version SharedWorker RPC boundary that broke the UI-state store in #1740.
const appVersion = '0.0.0-devtools-version-skew'
const skewAppVersion = (source: string) => source.replace('?? pkg.version', `?? ${JSON.stringify(appVersion)}`)
const versionSkewPlugin = (): Plugin => ({
  name: 'devtools-app-version-skew',
  enforce: 'pre',
  transform(source, id) {
    return id.endsWith('/@livestore/common/src/version.ts') === true ? skewAppVersion(source) : undefined
  },
})

const versionSkewOptimizerOptions: DepOptimizationOptions['esbuildOptions'] = {
  plugins: [
    {
      name: 'devtools-app-version-skew',
      setup(build) {
        build.onLoad({ filter: /\/@livestore\/common\/src\/version\.ts$/ }, async ({ path }) => ({
          contents: skewAppVersion(await readFile(path, 'utf8')),
          loader: 'ts',
        }))
      },
    },
  ],
}
