// @errors: 2578

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import vueDevTools from 'vite-plugin-vue-devtools'

import { livestoreDevtoolsPlugin } from '@livestore/devtools-vite'

export default defineConfig({
  // @ts-expect-error Plugin type mismatch due to duplicate vite instances in megarepo workspace resolution
  plugins: [vue(), vueDevTools(), livestoreDevtoolsPlugin({ schemaPath: './src/livestore/schema.ts' })],
  worker: { format: 'es' },
})
