import {
  baseTsconfigCompilerOptions,
  packageTsconfigCompilerOptions,
  packageTsconfigExclude,
  tsconfigJson,
} from '../../../genie/repo.ts'

/** wa-sqlite is a pre-built WASM package — dist/ contains Nix-built binaries checked into git.
 * Override outDir/tsBuildInfoFile so tsc --build doesn't clean the pre-built dist/ directory. */
export default tsconfigJson({
  compilerOptions: {
    ...baseTsconfigCompilerOptions,
    ...packageTsconfigCompilerOptions,
    outDir: './.tsc-out',
    tsBuildInfoFile: './.tsc-out/.tsbuildinfo',
    declaration: true,
    declarationMap: true,
  },
  include: ['src/**/*'],
  exclude: [...packageTsconfigExclude],
})
