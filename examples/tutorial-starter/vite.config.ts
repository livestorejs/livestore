import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, lazyPlugins } from 'vite-plus'

// https://vite.dev/config/
export default defineConfig({
  plugins: lazyPlugins(() => [react(), tailwindcss()]),
})
