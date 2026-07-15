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
    // Astro site: bundled app that emits no declarations, so it is not a valid
    // TypeScript project-reference target. `composite: false` both matches tsc's
    // requirement (referenced projects must be composite) and tells genie's
    // tsconfig-references validator to skip docs as a reference target, so
    // dependents (e.g. @local/scripts) are not required to reference it.
    composite: false,
    declaration: false,
    declarationMap: false,
    module: 'ESNext',
    moduleResolution: 'Bundler',
    target: 'ESNext',
    jsx: 'preserve',
    tsBuildInfoFile: './dist/.tsbuildinfo',
  },
  include: ['src'],
  exclude: [...packageTsconfigExclude, 'src/content/_assets/code/**/*'],
  references: [
    { path: '../packages/@livestore/adapter-cloudflare' },
    { path: '../packages/@livestore/adapter-web' },
    { path: '../packages/@livestore/common' },
    { path: '../packages/@livestore/livestore' },
    { path: '../packages/@livestore/react' },
    { path: '../packages/@livestore/sync-cf' },
    { path: '../packages/@livestore/utils' },
    { path: '../packages/@local/astro-tldraw' },
    { path: '../packages/@local/astro-twoslash-code' },
    { path: '../packages/@local/shared' },
  ],
})
