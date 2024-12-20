import commonjs from '@rollup/plugin-commonjs'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import terser from '@rollup/plugin-terser'

export default {
  input: 'dist/leader-thread.js',
  output: {
    file: 'dist/leader-thread.bundle.js',
    // dir: 'dist/leader-thread-bundle',
    format: 'esm',
    // inlineDynamicImports: true,
  },
  external: ['@livestore/sqlite-wasm', '@opentelemetry/otlp-exporter-base'],
  plugins: [
    nodeResolve({
      // esnext is needed for @opentelemetry/* packages
      mainFields: ['esnext', 'module', 'main'],
    }),
    commonjs(),
    terser(),
  ],
  // Needed for @opentelemetry/* packages
  // inlineDynamicImports: true,
}
