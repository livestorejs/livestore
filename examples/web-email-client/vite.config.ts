import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, searchForWorkspaceRoot } from 'vite'

import { livestoreDevtoolsPlugin } from '@livestore/devtools-vite'

export default defineConfig({
  plugins: [
    cloudflare(),
    react(),
    tailwindcss(),
    livestoreDevtoolsPlugin({ schemaPath: ['./src/stores/mailbox/schema.ts', './src/stores/thread/schema.ts'] }),
  ],
  optimizeDeps: {
    exclude: ['@livestore/wa-sqlite'],
  },
  server: {
    fs: {
      // Workaround: searchForWorkspaceRoot stops at examples/pnpm-workspace.yaml but doesn't
      // parse its package globs, so packages outside examples/ (like @livestore/wa-sqlite) are blocked.
      // See https://github.com/vitejs/vite/issues/21700
      allow: [searchForWorkspaceRoot(process.cwd()), '../../packages'],
    },
  },
})
