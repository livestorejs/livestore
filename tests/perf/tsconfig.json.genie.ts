import { tsconfigJSON } from '#genie/mod.ts'
import { reactJsx } from '../../genie/repo.ts'

export default tsconfigJSON({
  extends: '../../tsconfig.base.json',
  compilerOptions: {
    noEmit: true,
    ...reactJsx,
  },
  include: ['./test-app', './tests'],
  exclude: ['node_modules', '**/dist'],
  references: [
    { path: '../../packages/@livestore/adapter-web' },
    { path: '../../packages/@livestore/livestore' },
    { path: '../../packages/@livestore/react' },
    { path: '../../packages/@livestore/utils' },
    { path: '../../packages/@livestore/utils-dev' },
  ],
})
