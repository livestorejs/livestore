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
} as const

export default pnpmWorkspaceYaml.root({
  packages: rootWorkspacePackages,
  repoName: 'livestore',
  extraMembers: ['examples/*'],
  ...commonPnpmPolicySettings,
  allowBuilds: repoPnpmAllowBuilds,
  packageExtensions: repoPackageExtensions,
  patchedDependencies: {
    // Temporary patch until upstream fix lands: https://github.com/Effect-TS/effect/pull/6161
    '@effect/rpc@0.75.0': 'patches/@effect__rpc@0.75.0.patch',
  },
  /** Relaxed until @livestore/devtools-vite publishes with updated Effect peer ranges */
  strictPeerDependencies: false,
  ...examplesWorkspaceSettings,
})
