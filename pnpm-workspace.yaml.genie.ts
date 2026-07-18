import { catalog, commonPnpmPolicySettings, pnpmWorkspaceYaml, repoPnpmAllowBuilds } from './genie/repo.ts'
import { rootWorkspacePackages } from './package.json.genie.ts'

/**
 * The shared effect-utils pnpm policy still suppresses peer conflicts for
 * obsolete Effect v3 package names. Drop those suppressions in LiveStore so
 * stale v3 peers fail loudly during the v4 migration instead of being hidden.
 */
const { peerDependencyRules: _effectV3PeerDependencyRules, ...livestorePnpmPolicySettings } = commonPnpmPolicySettings

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
  ...livestorePnpmPolicySettings,
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
