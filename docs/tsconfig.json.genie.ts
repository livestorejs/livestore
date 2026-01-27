import { baseTsconfigCompilerOptions, packageTsconfigExclude, tsconfigJson } from '../genie/repo.ts'

/**
 * Astro docs site tsconfig.
 * Uses bundler resolution for Astro compatibility.
 * @see https://github.com/withastro/astro/blob/main/packages/astro/tsconfigs/base.json
 */
export default tsconfigJson({
  compilerOptions: {
    ...baseTsconfigCompilerOptions,
    outDir: './dist',
    rootDir: './src',
    resolveJsonModule: true,
    composite: false,
    declaration: false,
    declarationMap: false,
    moduleResolution: 'bundler',
    module: 'ESNext',
    target: 'ESNext',
    jsx: 'preserve',
    tsBuildInfoFile: './dist/.tsbuildinfo',
  },
  include: ['src'],
  exclude: [...packageTsconfigExclude, 'src/content/_assets/code/**/*'],
  references: [{ path: '../packages/@local/shared' }, { path: '../packages/@local/astro-twoslash-code' }],
})
