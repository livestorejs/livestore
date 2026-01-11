import { tsconfigJSON } from '#genie/mod.ts'
import { reactJsx } from '../../genie/repo.ts'

export default tsconfigJSON({
  extends: '../../tsconfig.base.json',
  compilerOptions: {
    exactOptionalPropertyTypes: false,
    outDir: './dist',
    rootDir: '.',
    resolveJsonModule: true,
    ...reactJsx,
    tsBuildInfoFile: './dist/.tsbuildinfo',
  },
  include: ['./src', './scripts'],
  exclude: ['./src/tests/devtools/fixtures'],
  references: [
    { path: '../../packages/@local/shared' },
    { path: '../../packages/@livestore/effect-playwright' },
    { path: '../../packages/@livestore/common' },
    { path: '../../packages/@livestore/react' },
    { path: '../../packages/@livestore/livestore' },
    { path: '../../packages/@livestore/adapter-node' },
    { path: '../../packages/@livestore/sync-cf' },
    { path: '../../packages/@livestore/utils' },
    { path: '../../packages/@livestore/utils-dev' },
    { path: '../../packages/@livestore/adapter-web' },
  ],
})
