import { livestoreDevtoolsPlugin } from '@livestore/devtools-vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const axiomEndpoint = env.AXIOM_OTEL_EXPORTER_OTLP_ENDPOINT
  const axiomToken = env.AXIOM_TOKEN
  const axiomDataset = env.AXIOM_DATASET

  return {
    server: {
      port: 60_006,
      fs: { strict: false },
      proxy:
        axiomEndpoint === undefined || axiomToken === undefined || axiomDataset === undefined
          ? undefined
          : {
              '/otlp/v1/traces': {
                target: getOrigin(axiomEndpoint),
                changeOrigin: true,
                rewrite: () => new URL(axiomEndpoint).pathname,
                headers: {
                  authorization: `Bearer ${axiomToken}`,
                  'x-axiom-dataset': axiomDataset,
                },
              },
            },
    },
    worker: { format: 'es' },
    optimizeDeps: {
      exclude: ['@livestore/wa-sqlite'],
    },
    plugins: [
      tanstackRouter({
        target: 'react',
        autoCodeSplitting: true,
      }),
      react(),
      livestoreDevtoolsPlugin({ schemaPath: './src/schema.ts' }),
    ],
  }
})

function getOrigin(url: string): string {
  const parsedUrl = new URL(url)
  return `${parsedUrl.protocol}//${parsedUrl.host}`
}
