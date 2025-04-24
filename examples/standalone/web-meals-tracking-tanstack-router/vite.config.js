// If you are using TanStack Router
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const isProdBuild = process.env.NODE_ENV === 'production'

export default defineConfig({
  plugins: [TanStackRouterVite(), viteReact()],

  // https://vite.dev/config/worker-options.html#worker-format
  worker: isProdBuild ? { format: 'es' } : undefined,

  // Required because of https://github.com/vitejs/vite/issues/8427
  optimizeDeps: { exclude: ['@livestore/wa-sqlite'] },
})
