import { livestorePackageDefaults, pkg } from '../../../genie/repo.ts'

export default pkg.package({
  name: '@livestore/devtools-expo',
  types: './dist/index.d.cts',
  main: './dist/index.cjs',
  dependencies: ['@livestore/adapter-node', '@livestore/utils'],
  devDependencies: ['@types/node', 'expo', 'vite'],
  peerDependencies: {
    expo: '^54.0.12',
  },
  ...livestorePackageDefaults,
  files: [...livestorePackageDefaults.files, 'expo-module.config.json', 'webui'],
  publishConfig: {
    access: 'public',
  },
  scripts: {
    test: 'echo No tests yet',
  },
})
