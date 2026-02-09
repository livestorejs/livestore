import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import vueDevTools from 'vite-plugin-vue-devtools'

import { livestoreDevtoolsPlugin } from '@livestore/devtools-vite'

export default defineConfig({
  plugins: [vue(), vueDevTools(), livestoreDevtoolsPlugin({ schemaPath: './src/livestore/schema.ts' })],
  worker: { format: 'es' },
})
