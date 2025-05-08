import { livestoreDevtoolsPlugin } from '@livestore/devtools-vite'
import { defineConfig } from 'vite'

const TEST_LIVESTORE_SCHEMA_PATH_JSON = process.env.TEST_LIVESTORE_SCHEMA_PATH_JSON

// https://vitejs.dev/config
export default defineConfig({
  server: { fs: { strict: false } },
  root: import.meta.dirname,
  optimizeDeps: {
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
  plugins: [
    TEST_LIVESTORE_SCHEMA_PATH_JSON
      ? livestoreDevtoolsPlugin({ schemaPath: JSON.parse(TEST_LIVESTORE_SCHEMA_PATH_JSON) })
      : undefined,
  ],
})
