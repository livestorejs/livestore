import tailwindcss from '@tailwindcss/vite'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const isProdBuild = process.env.NODE_ENV === 'production'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [tailwindcss(), TanStackRouterVite({ autoCodeSplitting: true }), viteReact()],
  worker: isProdBuild ? { format: 'es' } : undefined,
  // TODO: This required config is missing in the quickstart guide
  optimizeDeps: { exclude: ['@livestore/wa-sqlite'] },
})
