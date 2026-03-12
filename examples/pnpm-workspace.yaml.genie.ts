import { pnpmWorkspaceYaml } from '../genie/repo.ts'
/**
 * Examples workspace configuration
 *
 * This workspace is specifically for building/testing examples in CI.
 * It links to the local @livestore/* packages so examples can use the
 * latest code without publishing to npm.
 *
 * Key settings:
 * - linkWorkspacePackages: true - link local packages even when version doesn't match
 * - Includes all examples plus all local @livestore packages
 */
import adapterCloudflarePkg from '../packages/@livestore/adapter-cloudflare/package.json.genie.ts'
import adapterExpoPkg from '../packages/@livestore/adapter-expo/package.json.genie.ts'
import adapterNodePkg from '../packages/@livestore/adapter-node/package.json.genie.ts'
import adapterWebPkg from '../packages/@livestore/adapter-web/package.json.genie.ts'
import cliPkg from '../packages/@livestore/cli/package.json.genie.ts'
import commonCfPkg from '../packages/@livestore/common-cf/package.json.genie.ts'
import commonPkg from '../packages/@livestore/common/package.json.genie.ts'
import devtoolsExpoPkg from '../packages/@livestore/devtools-expo/package.json.genie.ts'
import devtoolsWebCommonPkg from '../packages/@livestore/devtools-web-common/package.json.genie.ts'
import effectPlaywrightPkg from '../packages/@livestore/effect-playwright/package.json.genie.ts'
import frameworkToolkitPkg from '../packages/@livestore/framework-toolkit/package.json.genie.ts'
import graphqlPkg from '../packages/@livestore/graphql/package.json.genie.ts'
import livestorePkg from '../packages/@livestore/livestore/package.json.genie.ts'
import peerDepsPkg from '../packages/@livestore/peer-deps/package.json.genie.ts'
import reactPkg from '../packages/@livestore/react/package.json.genie.ts'
import solidPkg from '../packages/@livestore/solid/package.json.genie.ts'
import sqliteWasmPkg from '../packages/@livestore/sqlite-wasm/package.json.genie.ts'
import sveltePkg from '../packages/@livestore/svelte/package.json.genie.ts'
import syncCfPkg from '../packages/@livestore/sync-cf/package.json.genie.ts'
import syncElectricPkg from '../packages/@livestore/sync-electric/package.json.genie.ts'
import syncS2Pkg from '../packages/@livestore/sync-s2/package.json.genie.ts'
import utilsDevPkg from '../packages/@livestore/utils-dev/package.json.genie.ts'
import utilsPkg from '../packages/@livestore/utils/package.json.genie.ts'
import waSqlitePkg from '../packages/@livestore/wa-sqlite/package.json.genie.ts'
import webmeshPkg from '../packages/@livestore/webmesh/package.json.genie.ts'

const packages = [
  adapterCloudflarePkg,
  adapterExpoPkg,
  adapterNodePkg,
  adapterWebPkg,
  cliPkg,
  commonCfPkg,
  commonPkg,
  devtoolsExpoPkg,
  devtoolsWebCommonPkg,
  effectPlaywrightPkg,
  frameworkToolkitPkg,
  graphqlPkg,
  livestorePkg,
  peerDepsPkg,
  reactPkg,
  solidPkg,
  sqliteWasmPkg,
  sveltePkg,
  syncCfPkg,
  syncElectricPkg,
  syncS2Pkg,
  utilsDevPkg,
  utilsPkg,
  waSqlitePkg,
  webmeshPkg,
] as const

export const examplesWorkspaceData = {
  linkWorkspacePackages: true,
  dedupePeerDependents: true,
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

export default pnpmWorkspaceYaml.manual({
  packages: ['*', ...packages.map((pkg) => pkg.meta.workspace.memberPath)],
  ...examplesWorkspaceData,
})
