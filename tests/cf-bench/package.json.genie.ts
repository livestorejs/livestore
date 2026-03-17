import { localPackageDefaults, packageJson } from '../../genie/repo.ts'

/**
 * cf-bench is a standalone workspace (own pnpm-workspace.yaml) used for
 * manual benchmarking of the CF adapter. Dependencies are pinned manually
 * since this package is not part of the monorepo's pnpm workspace.
 */
export default packageJson({
  name: '@local/cf-bench',
  ...localPackageDefaults,
  scripts: {
    dev: 'wrangler dev',
    deploy: 'wrangler deploy',
    bench: './run-bench.sh',
  },
  dependencies: {
    '@cloudflare/workers-types': '4.20251118.0',
    '@livestore/adapter-cloudflare': 'workspace:*',
    '@livestore/common': 'workspace:*',
    '@livestore/common-cf': 'workspace:*',
    '@livestore/livestore': 'workspace:*',
    '@livestore/sync-cf': 'workspace:*',
    '@livestore/utils': 'workspace:*',
  },
  devDependencies: {
    wrangler: '^4.42.2',
  },
})
