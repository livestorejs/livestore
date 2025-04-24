import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const isProdBuild = process.env.NODE_ENV === 'production'

export default defineConfig({
  plugins: [TanStackRouterVite(), viteReact()],
  worker: isProdBuild ? { format: 'es' } : undefined,
  optimizeDeps: { exclude: ['@livestore/wa-sqlite'] },
})
