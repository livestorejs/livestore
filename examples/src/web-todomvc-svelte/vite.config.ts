import { livestoreDevtoolsPlugin } from '@livestore/devtools-vite'
import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [sveltekit(), livestoreDevtoolsPlugin({ schemaPath: './src/lib/livestore/schema.ts' })],
})
