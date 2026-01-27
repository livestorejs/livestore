import { catalog, livestorePackageDefaults, packageJson } from '../../../genie/repo.ts'

export default packageJson({
  name: '@livestore/devtools-expo',
  ...livestorePackageDefaults,
  types: './dist/index.d.cts',
  main: './dist/index.cjs',
  dependencies: { ...catalog.pick('@livestore/adapter-node', '@livestore/utils') },
  devDependencies: { ...catalog.pick('@types/node', 'expo', 'vite') },
  peerDependencies: {
    expo: '^54.0.12',
  },
  files: [...livestorePackageDefaults.files, 'expo-module.config.json', 'webui'],
  publishConfig: {
    access: 'public',
  },
  scripts: {
    test: 'echo No tests yet',
  },
})
