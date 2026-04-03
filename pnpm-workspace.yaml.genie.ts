import { commonPnpmPolicySettings, pnpmWorkspaceYaml, repoPnpmAllowBuilds } from './genie/repo.ts'
import { rootWorkspacePackages } from './package.json.genie.ts'

const examplesWorkspaceSettings = {
  linkWorkspacePackages: true,
  overrides: {
    /** Dedupe effect packages pulled in transitively by vue-livestore@0.2.3 (via @livestore/peer-deps@0.3.1) */
    'effect': '3.21.0',
    '@effect/platform': '0.96.0',
    '@effect/platform-browser': '0.76.0',
    '@effect/platform-bun': '0.89.0',
    '@effect/platform-node': '0.106.0',
    '@effect/platform-node-shared': '0.59.0',
    '@effect/cli': '0.75.0',
    '@effect/experimental': '0.60.0',
    '@effect/opentelemetry': '0.63.0',
    '@effect/printer': '0.49.0',
    '@effect/printer-ansi': '0.49.0',
    '@effect/typeclass': '0.40.0',
    /** Dedupe react/react-dom for examples still on 19.1.0 */
    'react': '19.2.3',
    'react-dom': '19.2.3',
    '@tanstack/router-core': '1.139.14',
    '@tanstack/history': '1.139.0',
    '@tanstack/react-router': '1.139.14',
    '@tanstack/react-start': '1.139.14',
    '@tanstack/router-devtools': '1.139.14',
    '@tanstack/router-devtools-core': '1.139.14',
    '@tanstack/react-router-devtools': '1.139.14',
    '@tanstack/router-plugin': '1.139.14',
    '@tanstack/start-plugin-core': '1.139.14',
    '@tanstack/start-server-core': '1.139.14',
    '@tanstack/start-client-core': '1.139.14',
  },
} as const

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
  /** Relaxed until @livestore/devtools-vite publishes with updated Effect peer ranges */
  strictPeerDependencies: false,
  ...examplesWorkspaceSettings,
})
