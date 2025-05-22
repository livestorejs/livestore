import { livestoreDevtoolsPlugin } from '@livestore/devtools-vite'
import { defineConfig } from 'vite'
import solidPlugin from 'vite-plugin-solid'
// import devtools from 'solid-devtools/vite';

const isProdBuild = process.env.NODE_ENV === 'production'

export default defineConfig({
  server: {
    port: 3000,
  },
  build: {
    target: 'esnext',
  },
  worker: isProdBuild ? { format: 'es' } : undefined,
  optimizeDeps: {
    // TODO remove once fixed https://github.com/vitejs/vite/issues/8427
    exclude: ['@livestore/wa-sqlite'],
  },
  plugins: [
    /*
    Uncomment the following line to enable solid-devtools.
    For more info see https://github.com/thetarnav/solid-devtools/tree/main/packages/extension#readme
    */
    // devtools(),
    solidPlugin({ exclude: ['@livestore/**devtools**', 'react-dom/**'] }),
    livestoreDevtoolsPlugin({ schemaPath: './src/livestore/schema.ts' }),
  ],
})
