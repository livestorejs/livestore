import {
  catalog,
  livestorePackageDefaults,
  packageJson,
  workspaceMember,
  getUtilsPeerDeps,
} from '../../../genie/repo.ts'
import adapterNodePkg from '../adapter-node/package.json.genie.ts'
import utilsPkg from '../utils/package.json.genie.ts'

const runtimeDeps = catalog.compose({
  workspace: workspaceMember('packages/@livestore/devtools-expo'),
  dependencies: {
    workspace: [adapterNodePkg, utilsPkg],
  },
  devDependencies: {
    external: catalog.pick('@types/node', 'expo', 'vite'),
  },
  peerDependencies: {
    external: {
      ...getUtilsPeerDeps(),
      ...catalog.peers('@livestore/devtools-vite'),
      expo: '^54.0.12',
    },
  },
})

export default packageJson(
  {
    name: '@livestore/devtools-expo',
    ...livestorePackageDefaults,
    types: './dist/index.d.cts',
    main: './dist/index.cjs',
    peerDependenciesMeta: adapterNodePkg.data.peerDependenciesMeta,
    files: [...livestorePackageDefaults.files, 'expo-module.config.json', 'webui'],
    publishConfig: {
      access: 'public',
    },
    scripts: {
      test: 'echo No tests yet',
    },
  },
  runtimeDeps,
)
