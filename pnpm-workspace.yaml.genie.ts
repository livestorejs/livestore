import { catalog, commonPnpmPolicySettings, pnpmWorkspaceYaml, repoPnpmAllowBuilds } from './genie/repo.ts'
import { rootWorkspacePackages } from './package.json.genie.ts'

const examplesWorkspaceSettings = {
  linkWorkspacePackages: true,
  /** Dedupe packages pulled in transitively by older example/peer-deps dependencies */
  overrides: catalog.pick(
    'effect',
    '@effect/platform',
    '@effect/platform-browser',
    '@effect/platform-bun',
    '@effect/platform-node',
    '@effect/platform-node-shared',
    '@effect/cli',
    '@effect/experimental',
    '@effect/opentelemetry',
    '@effect/printer',
    '@effect/printer-ansi',
    '@effect/typeclass',
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
  'starlight-auto-sidebar': {
    dependencies: {
      astro: '>=5.0.0',
    },
  },
  'starlight-links-validator': {
    dependencies: {
      astro: '>=5.0.0',
    },
  },
  'starlight-sidebar-topics': {
    dependencies: {
      astro: '>=5.0.0',
    },
  },
  typedoc: {
    dependencies: {
      'typedoc-plugin-markdown': '^4.8.1',
    },
  },
  /**
   * The published @livestore/devtools-vite bundles @parcel/watcher and does a
   * runtime `require('@parcel/watcher-<platform>')`. Under the pure-pnpm global
   * virtual store that prebuilt platform package is not reachable from the
   * bundle's location, so the example/integration vite builds fail with
   * "Cannot require module ./build/Release/watcher.node". Inject the platform
   * packages directly into devtools-vite's dependency closure so the require
   * resolves. Declared optional + os/cpu-scoped so only the matching platform
   * is installed.
   */
  '@livestore/devtools-vite': {
    optionalDependencies: {
      '@parcel/watcher-linux-x64-glibc': '2.5.6',
      '@parcel/watcher-linux-x64-musl': '2.5.6',
      '@parcel/watcher-linux-arm64-glibc': '2.5.6',
      '@parcel/watcher-linux-arm64-musl': '2.5.6',
      '@parcel/watcher-darwin-x64': '2.5.6',
      '@parcel/watcher-darwin-arm64': '2.5.6',
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
   * makes TypeScript see duplicate package identities through GVS links.
   */
  injectWorkspacePackages: false,
  allowBuilds: repoPnpmAllowBuilds,
  packageExtensions: repoPackageExtensions,
  /** Relaxed until @livestore/devtools-vite publishes with updated Effect peer ranges */
  strictPeerDependencies: false,
  ...examplesWorkspaceSettings,
})
