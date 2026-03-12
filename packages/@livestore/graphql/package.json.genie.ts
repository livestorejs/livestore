import { catalog, livestorePackageDefaults, packageJson } from '../../../genie/repo.ts'
import commonPkg from '../common/package.json.genie.ts'
import livestorePkg from '../livestore/package.json.genie.ts'
import utilsPkg from '../utils/package.json.genie.ts'

const runtimeDeps = catalog.compose({
  dir: import.meta.dirname,
  dependencies: {
    workspace: [commonPkg, livestorePkg, utilsPkg],
    external: catalog.pick('@graphql-typed-document-node/core', '@opentelemetry/api'),
  },
  devDependencies: {
    external: catalog.pick('graphql'),
  },
})

export default packageJson(
  {
    name: '@livestore/graphql',
    ...livestorePackageDefaults,
    exports: {
      '.': './src/index.ts',
    },
    peerDependencies: {
      ...utilsPkg.data.peerDependencies,
      graphql: '^16.11.0',
    },
    publishConfig: {
      access: 'public',
      exports: {
        '.': './dist/index.js',
      },
    },
    scripts: {
      test: "echo 'No tests'",
    },
  },
  runtimeDeps,
)
