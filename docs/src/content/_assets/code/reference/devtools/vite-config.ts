// @errors: 2578

import { livestoreDevtoolsPlugin } from '@livestore/devtools-vite'
import { defineConfig } from 'vite'

export default defineConfig({
  // ...
  // @ts-expect-error livestore-devtools Plugin type mismatch due to different vite instances
  plugins: [livestoreDevtoolsPlugin({ schemaPath: './src/livestore/schema.ts' })],
})
