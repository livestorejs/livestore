import { catalog, livestorePackageDefaults, packageJson, workspaceMember } from '../../../genie/repo.ts'

const runtimeDeps = catalog.compose({
  workspace: workspaceMember('packages/@livestore/wa-sqlite'),
  devDependencies: {
    external: catalog.pick(
      '@types/jasmine',
      '@web/dev-server',
      '@web/test-runner',
      '@web/test-runner-core',
      'comlink',
      'jasmine-core',
      'monaco-editor',
      'typescript',
      'typedoc',
      'web-test-runner-jasmine',
    ),
  },
})

export default packageJson(
  {
    name: '@livestore/wa-sqlite',
    version: livestorePackageDefaults.version,
    type: 'module',
    repository: livestorePackageDefaults.repository,
    types: 'src/types/index.d.ts',
    main: 'src/sqlite-api.js',
    exports: {
      '.': {
        types: './src/types/index.d.ts',
        default: './src/sqlite-api.js',
      },
      './src/sqlite-api.js': './src/sqlite-api.js',
      './src/sqlite-constants.js': './src/sqlite-constants.js',
      './src/VFS.js': './src/VFS.js',
      './src/FacadeVFS.js': './src/FacadeVFS.js',
      './src/WebLocksMixin.js': './src/WebLocksMixin.js',
      './src/examples/*': './src/examples/*',
      './dist/*': './dist/*',
    },
    dependenciesMeta: {
      'monaco-editor@0.34.1': {
        unplugged: true,
      },
      'web-test-runner-jasmine@0.0.6': {
        unplugged: true,
      },
    },
    files: [
      'src/sqlite-constants.js',
      'src/sqlite-api.js',
      'src/types/*',
      'src/FacadeVFS.js',
      'src/VFS.js',
      'src/WebLocksMixin.js',
      'src/examples/*',
      'dist/*',
      'test/*',
    ],
    scripts: {
      'build-docs': 'typedoc',
      start: 'web-dev-server --node-resolve',
      test: 'web-test-runner',
      'test-manual': 'web-test-runner --manual',
    },
  },
  runtimeDeps,
)
