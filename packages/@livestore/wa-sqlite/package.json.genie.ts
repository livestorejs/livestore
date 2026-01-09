import { pkg } from '../../../genie/repo.ts'

export default pkg({
  name: '@livestore/wa-sqlite',
  version: '0.4.0-dev.22',
  type: 'module',
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
  devDependencies: [
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
  ],
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
})
