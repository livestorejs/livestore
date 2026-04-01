import { commonPnpmPolicySettings, pnpmWorkspaceYaml, repoPnpmAllowBuilds } from './genie/repo.ts'
import { rootWorkspacePackages } from './package.json.genie.ts'

const examplesWorkspaceSettings = {
  linkWorkspacePackages: true,
  overrides: {
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
