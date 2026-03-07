import { defineConfig } from 'vite'

import { livestoreDevtoolsPlugin } from '@livestore/devtools-vite'

export default defineConfig({
  // ...
  plugins: [livestoreDevtoolsPlugin({ schemaPath: './src/livestore/schema.ts' })],
})
