import { catalog, commonPnpmPolicySettings, pnpmWorkspaceYaml, repoPnpmAllowBuilds } from './genie/repo.ts'
import { rootWorkspacePackages } from './package.json.genie.ts'

const effectV4MinimumReleaseAgeExclude = Object.entries(
  catalog.pick(
    'effect',
    '@effect/ai-openai',
    '@effect/opentelemetry',
    '@effect/platform-browser',
    '@effect/platform-bun',
    '@effect/platform-node',
    '@effect/platform-node-shared',
    '@effect/sql-sqlite-node',
    '@effect/vitest',
  ),
).map(([name, version]) => `${name}@${version}`)

const examplesWorkspaceSettings = {
  linkWorkspacePackages: true,
  /** Dedupe package identities pulled in transitively by older example and peer-deps packages. */
  overrides: catalog.pick(
    'effect',
    '@effect/platform-browser',
    '@effect/platform-bun',
    '@effect/platform-node',
    '@effect/platform-node-shared',
    '@effect/opentelemetry',
    '@effect/vitest',
    'react',
    'react-dom',
    '@tanstack/router-core',
    '@tanstack/history',
    '@tanstack/react-router',
    '@tanstack/react-start',
    '@tanstack/router-devtools',
    '@tanstack/router-devtools-core',
    '@tanstack/react-router-devtools',
    '@tanstack/router-plugin',
    '@tanstack/start-plugin-core',
    '@tanstack/start-server-core',
    '@tanstack/start-client-core',
  ),
}

export const repoPackageExtensions = {
  '@livestore/devtools-vite': {
    dependencies: {
      '@parcel/watcher': '^2.5.6',
    },
  },
  'starlight-auto-sidebar': {
    dependencies: {
      astro: '>=6.0.0',
    },
  },
  'starlight-links-validator': {
    dependencies: {
      astro: '>=6.0.0',
    },
  },
  'starlight-sidebar-topics': {
    dependencies: {
      astro: '>=6.0.0',
    },
  },
  typedoc: {
    dependencies: {
      'typedoc-plugin-markdown': '^4.8.1',
    },
  },
} as const

export default pnpmWorkspaceYaml.root({
  packages: rootWorkspacePackages,
  repoName: 'livestore',
  extraMembers: ['examples/*'],
  ...commonPnpmPolicySettings,
  /**
   * LiveStore's live CI/dev workspace typechecks package source and generated
   * dist outputs together. pnpm's injected workspace snapshots are still used
   * by Nix/FOD package preparation, but enabling them for the live workspace
   * makes TypeScript see duplicate package identities across injected and
   * source workspace views.
   */
  injectWorkspacePackages: false,
  allowBuilds: repoPnpmAllowBuilds,
  packageExtensions: repoPackageExtensions,
  minimumReleaseAgeExclude: [
    ...commonPnpmPolicySettings.minimumReleaseAgeExclude,
    ...effectV4MinimumReleaseAgeExclude,
    // The already-published stable cohort is the reviewed production promotion source.
    '@livestore/adapter-web@0.5.1',
    '@livestore/common-cf@0.5.1',
    '@livestore/common@0.5.1',
    '@livestore/devtools-vite@0.5.1',
    '@livestore/sqlite-wasm@0.5.1',
    '@livestore/utils@0.5.1',
    '@livestore/wa-sqlite@0.5.1',
    '@livestore/webmesh@0.5.1',
  ],
  /** Relaxed until @livestore/devtools-vite publishes with updated Effect peer ranges */
  strictPeerDependencies: false,
  ...examplesWorkspaceSettings,
})
