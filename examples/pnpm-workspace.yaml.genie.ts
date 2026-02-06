/**
 * Examples workspace configuration
 *
 * This workspace is specifically for building/testing examples in CI.
 * It links to the local @livestore/* packages so examples can use the
 * latest code without publishing to npm.
 *
 * Key settings:
 * - linkWorkspacePackages: true - link local packages even when version doesn't match
 * - Includes both examples/* and packages/@livestore/* so workspace:* resolution works
 */
import { pnpmWorkspaceYaml } from '../genie/repo.ts'

export default pnpmWorkspaceYaml({
  packages: [
    // All examples
    '*',
    // Include @livestore packages so they can be linked
    '../packages/@livestore/*',
  ],
  // Link workspace packages even when the specifier version doesn't exactly match
  // the workspace package version. This allows examples with fixed versions like
  // "@livestore/solid": "0.4.0-dev.22" to resolve to the local workspace package.
  linkWorkspacePackages: true,
  dedupePeerDependents: true,
  // Force all TanStack router packages to the same version to avoid runtime errors
  // from version mismatches (e.g., router.serverSsr?.isSerializationFinished not found)
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
})
