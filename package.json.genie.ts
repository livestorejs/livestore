import docsPkg from './docs/package.json.genie.ts'
import docsCodeSnippetsPkg from './docs/src/content/_assets/code/package.json.genie.ts'
import { packageJson } from './genie/repo.ts'
import adapterCloudflarePkg from './packages/@livestore/adapter-cloudflare/package.json.genie.ts'
import adapterExpoPkg from './packages/@livestore/adapter-expo/package.json.genie.ts'
import adapterNodePkg from './packages/@livestore/adapter-node/package.json.genie.ts'
import adapterWebPkg from './packages/@livestore/adapter-web/package.json.genie.ts'
import cliPkg from './packages/@livestore/cli/package.json.genie.ts'
import commonCfPkg from './packages/@livestore/common-cf/package.json.genie.ts'
import commonPkg from './packages/@livestore/common/package.json.genie.ts'
import devtoolsExpoPkg from './packages/@livestore/devtools-expo/package.json.genie.ts'
import devtoolsWebCommonPkg from './packages/@livestore/devtools-web-common/package.json.genie.ts'
import effectPlaywrightPkg from './packages/@livestore/effect-playwright/package.json.genie.ts'
import frameworkToolkitPkg from './packages/@livestore/framework-toolkit/package.json.genie.ts'
import graphqlPkg from './packages/@livestore/graphql/package.json.genie.ts'
import livestorePkg from './packages/@livestore/livestore/package.json.genie.ts'
import peerDepsPkg from './packages/@livestore/peer-deps/package.json.genie.ts'
import reactPkg from './packages/@livestore/react/package.json.genie.ts'
import solidPkg from './packages/@livestore/solid/package.json.genie.ts'
import sqliteWasmPkg from './packages/@livestore/sqlite-wasm/package.json.genie.ts'
import sveltePkg from './packages/@livestore/svelte/package.json.genie.ts'
import syncCfPkg from './packages/@livestore/sync-cf/package.json.genie.ts'
import syncElectricPkg from './packages/@livestore/sync-electric/package.json.genie.ts'
import syncS2Pkg from './packages/@livestore/sync-s2/package.json.genie.ts'
import utilsDevPkg from './packages/@livestore/utils-dev/package.json.genie.ts'
import utilsPkg from './packages/@livestore/utils/package.json.genie.ts'
import waSqlitePkg from './packages/@livestore/wa-sqlite/package.json.genie.ts'
import webmeshPkg from './packages/@livestore/webmesh/package.json.genie.ts'
import astroTldrawPkg from './packages/@local/astro-tldraw/package.json.genie.ts'
import astroTwoslashCodeExamplePkg from './packages/@local/astro-twoslash-code/example/package.json.genie.ts'
import astroTwoslashCodePkg from './packages/@local/astro-twoslash-code/package.json.genie.ts'
import localSharedPkg from './packages/@local/shared/package.json.genie.ts'
import scriptsPkg from './scripts/package.json.genie.ts'
import testsIntegrationPkg from './tests/integration/package.json.genie.ts'
import testsPackageCommonPkg from './tests/package-common/package.json.genie.ts'
import testsPerfEventlogPkg from './tests/perf-eventlog/package.json.genie.ts'
import testsPerfPkg from './tests/perf/package.json.genie.ts'
import testsSyncProviderPkg from './tests/sync-provider/package.json.genie.ts'
import testsWaSqlitePkg from './tests/wa-sqlite/package.json.genie.ts'

export const rootWorkspacePackages = [
  docsPkg,
  docsCodeSnippetsPkg,
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
  astroTldrawPkg,
  astroTwoslashCodeExamplePkg,
  astroTwoslashCodePkg,
  localSharedPkg,
  scriptsPkg,
  testsIntegrationPkg,
  testsPackageCommonPkg,
  testsPerfEventlogPkg,
  testsPerfPkg,
  testsSyncProviderPkg,
  testsWaSqlitePkg,
] as const

const coreWorkspaceExclusions = [
  'docs',
  'scripts',
  'tests',
  'packages/@local/astro-tldraw',
  'packages/@local/astro-twoslash-code',
] as const

const isWorkspacePackageExcluded = (
  excludedPaths: readonly string[],
  workspacePackage: (typeof rootWorkspacePackages)[number],
) =>
  excludedPaths.some(
    (excludedPath) =>
      workspacePackage.meta.workspace.memberPath === excludedPath ||
      workspacePackage.meta.workspace.memberPath.startsWith(`${excludedPath}/`),
  )

const isCoreWorkspacePackage = (workspacePackage: (typeof rootWorkspacePackages)[number]) =>
  isWorkspacePackageExcluded(coreWorkspaceExclusions, workspacePackage) === false

/**
 * Livestore core workspace packages.
 *
 * This is the install-projection used by the core workspace root in
 * `genie/projections/core/`.
 * It intentionally excludes examples, docs, tests, scripts, and local demo packages
 * so downstream consumers can install the production/library graph without the
 * full repo breadth.
 */
export const coreWorkspacePackages = rootWorkspacePackages.filter(isCoreWorkspacePackage)

const toolingWorkspacePackagesByPath = new Set([
  ...coreWorkspacePackages.map((workspacePackage) => workspacePackage.meta.workspace.memberPath),
  'docs',
  'docs/src/content/_assets/code',
  'packages/@local/astro-tldraw',
  'packages/@local/astro-twoslash-code',
  'scripts',
  'tests/integration',
  'tests/sync-provider',
])

/**
 * Livestore tooling workspace packages.
 *
 * This extends the core projection with the local/docs/tooling packages needed
 * by downstream devtools and release workflows without pulling in the full repo
 * workspace breadth.
 */
export const toolingWorkspacePackages = rootWorkspacePackages.filter((workspacePackage) =>
  toolingWorkspacePackagesByPath.has(workspacePackage.meta.workspace.memberPath),
)

const rootWorkspaceBase = packageJson.aggregateFromPackages({
  packages: rootWorkspacePackages,
  name: 'livestore-workspace',
  repoName: 'livestore',
  extraMembers: ['examples/*'],
})

const rootWorkspaceExtraFields = {
  scripts: {
    changeset: 'changeset',
    'changeset:status': 'changeset status',
    'changeset:version': 'changeset version',
  },
  devDependencies: {
    '@changesets/cli': '^2.31.0',
  },
} as const

const rootWorkspace = {
  ...rootWorkspaceBase,
  data: {
    ...rootWorkspaceBase.data,
    ...rootWorkspaceExtraFields,
  },
  stringify: (ctx: Parameters<typeof rootWorkspaceBase.stringify>[0]) => {
    const generated = JSON.parse(rootWorkspaceBase.stringify(ctx))
    return `${JSON.stringify(
      {
        ...generated,
        scripts: {
          ...generated.scripts,
          ...rootWorkspaceExtraFields.scripts,
        },
        devDependencies: {
          ...generated.devDependencies,
          ...rootWorkspaceExtraFields.devDependencies,
        },
      },
      null,
      2,
    )}\n`
  },
} satisfies typeof rootWorkspaceBase

export const rootWorkspaceMemberPaths = rootWorkspace.data.workspaces

export default rootWorkspace
