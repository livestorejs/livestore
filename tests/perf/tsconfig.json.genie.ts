import { baseTsconfigCompilerOptions, packageTsconfigExclude, reactJsx, tsconfigJson } from '../../genie/repo.ts'

export default tsconfigJson({
  compilerOptions: {
    ...baseTsconfigCompilerOptions,
    noEmit: true,
    ...reactJsx,
  },
  include: ['./test-app', './tests'],
  exclude: [...packageTsconfigExclude],
  references: [
    { path: '../../packages/@livestore/adapter-web' },
    { path: '../../packages/@livestore/livestore' },
    { path: '../../packages/@livestore/react' },
    { path: '../../packages/@livestore/utils' },
    { path: '../../packages/@livestore/utils-dev' },
  ],
})
