import docsTsconfig from '../docs/tsconfig.json.genie.ts'
import docsCodeTsconfig from '../docs/src/content/_assets/code/tsconfig.json.genie.ts'
import { rootWorkspacePackages } from '../package.json.genie.ts'
import adapterCloudflareTsconfig from '../packages/@livestore/adapter-cloudflare/tsconfig.json.genie.ts'
import adapterWebTsconfig from '../packages/@livestore/adapter-web/tsconfig.json.genie.ts'
import commonTsconfig from '../packages/@livestore/common/tsconfig.json.genie.ts'
import commonCfTsconfig from '../packages/@livestore/common-cf/tsconfig.json.genie.ts'
import effectPlaywrightTsconfig from '../packages/@livestore/effect-playwright/tsconfig.json.genie.ts'
import frameworkToolkitTsconfig from '../packages/@livestore/framework-toolkit/tsconfig.json.genie.ts'
import livestoreTsconfig from '../packages/@livestore/livestore/tsconfig.json.genie.ts'
import reactTsconfig from '../packages/@livestore/react/tsconfig.json.genie.ts'
import sqliteWasmTsconfig from '../packages/@livestore/sqlite-wasm/tsconfig.json.genie.ts'
import syncCfTsconfig from '../packages/@livestore/sync-cf/tsconfig.json.genie.ts'
import utilsTsconfig from '../packages/@livestore/utils/tsconfig.json.genie.ts'
import utilsDevTsconfig from '../packages/@livestore/utils-dev/tsconfig.json.genie.ts'
import waSqliteTsconfig from '../packages/@livestore/wa-sqlite/tsconfig.json.genie.ts'
import webmeshTsconfig from '../packages/@livestore/webmesh/tsconfig.json.genie.ts'
import astroTldrawTsconfig from '../packages/@local/astro-tldraw/tsconfig.json.genie.ts'
import astroTwoslashCodeTsconfig from '../packages/@local/astro-twoslash-code/tsconfig.json.genie.ts'
import astroTwoslashExampleTsconfig from '../packages/@local/astro-twoslash-code/example/tsconfig.json.genie.ts'
import localSharedTsconfig from '../packages/@local/shared/tsconfig.json.genie.ts'
import scriptsTsconfig from '../scripts/tsconfig.json.genie.ts'
import integrationTsconfig from '../tests/integration/tsconfig.json.genie.ts'
import packageCommonTsconfig from '../tests/package-common/tsconfig.json.genie.ts'
import perfTsconfig from '../tests/perf/tsconfig.json.genie.ts'
import perfEventlogTsconfig from '../tests/perf-eventlog/tsconfig.json.genie.ts'
import syncProviderTsconfig from '../tests/sync-provider/tsconfig.json.genie.ts'
import testWaSqliteTsconfig from '../tests/wa-sqlite/tsconfig.json.genie.ts'
import type { GenieOutput, TSConfigArgs } from '../repos/effect-utils/genie/external.ts'

export type RootTsconfigProject = {
  path: string
  tsconfig: GenieOutput<TSConfigArgs> | undefined
}

const workspaceTsconfigsByPath = new Map<string, GenieOutput<TSConfigArgs>>([
  ['docs', docsTsconfig],
  ['docs/src/content/_assets/code', docsCodeTsconfig],
  ['packages/@livestore/adapter-cloudflare', adapterCloudflareTsconfig],
  ['packages/@livestore/adapter-web', adapterWebTsconfig],
  ['packages/@livestore/common', commonTsconfig],
  ['packages/@livestore/common-cf', commonCfTsconfig],
  ['packages/@livestore/effect-playwright', effectPlaywrightTsconfig],
  ['packages/@livestore/framework-toolkit', frameworkToolkitTsconfig],
  ['packages/@livestore/livestore', livestoreTsconfig],
  ['packages/@livestore/react', reactTsconfig],
  ['packages/@livestore/sqlite-wasm', sqliteWasmTsconfig],
  ['packages/@livestore/sync-cf', syncCfTsconfig],
  ['packages/@livestore/utils', utilsTsconfig],
  ['packages/@livestore/utils-dev', utilsDevTsconfig],
  ['packages/@livestore/wa-sqlite', waSqliteTsconfig],
  ['packages/@livestore/webmesh', webmeshTsconfig],
  ['packages/@local/astro-tldraw', astroTldrawTsconfig],
  ['packages/@local/astro-twoslash-code', astroTwoslashCodeTsconfig],
  ['packages/@local/astro-twoslash-code/example', astroTwoslashExampleTsconfig],
  ['packages/@local/shared', localSharedTsconfig],
  ['scripts', scriptsTsconfig],
  ['tests/integration', integrationTsconfig],
  ['tests/package-common', packageCommonTsconfig],
  ['tests/perf', perfTsconfig],
  ['tests/perf-eventlog', perfEventlogTsconfig],
  ['tests/sync-provider', syncProviderTsconfig],
  ['tests/wa-sqlite', testWaSqliteTsconfig],
])

// @livestore/peer-deps is a dependency-policy carrier package with no TypeScript project.
const rootWorkspacePackagePaths = rootWorkspacePackages
  .map((pkg) => pkg.meta.workspace.memberPath)
  .filter((path) => path !== 'packages/@livestore/peer-deps')

const missingTsconfigPaths = rootWorkspacePackagePaths.filter(
  (path) => workspaceTsconfigsByPath.has(path) === false,
)
const extraTsconfigPaths = [...workspaceTsconfigsByPath.keys()].filter(
  (path) => rootWorkspacePackagePaths.includes(path) === false,
)

if (missingTsconfigPaths.length > 0 || extraTsconfigPaths.length > 0) {
  throw new Error(
    [
      'root tsconfig project registry drifted from rootWorkspacePackages',
      missingTsconfigPaths.length > 0
        ? `missing tsconfig data for workspace packages: ${missingTsconfigPaths.join(', ')}`
        : undefined,
      extraTsconfigPaths.length > 0
        ? `tsconfig data without workspace package: ${extraTsconfigPaths.join(', ')}`
        : undefined,
    ]
      .filter((line) => line !== undefined)
      .join('\n'),
  )
}

const workspaceTsconfigProject = (path: string): RootTsconfigProject => {
  const tsconfig = workspaceTsconfigsByPath.get(path)
  if (tsconfig === undefined) {
    throw new Error(`missing tsconfig data for workspace package: ${path}`)
  }
  return { path, tsconfig }
}

const workspaceProjectsByPath = new Map(
  rootWorkspacePackagePaths.map((path) => [path, workspaceTsconfigProject(path)]),
)

const generatedCheckProjectPaths = [
  'docs/src/content/_assets/code',
  'scripts',
  'packages/@local/astro-tldraw',
  'packages/@local/astro-twoslash-code',
  'tests/integration',
  'tests/package-common',
  'tests/perf',
  'tests/sync-provider',
  'tests/wa-sqlite',
  'packages/@local/shared',
  'packages/@livestore/adapter-cloudflare',
  'packages/@livestore/adapter-web',
  'packages/@livestore/common',
  'packages/@livestore/common-cf',
  'packages/@livestore/effect-playwright',
  'packages/@livestore/framework-toolkit',
  'packages/@livestore/livestore',
  'packages/@livestore/react',
  'packages/@livestore/sqlite-wasm',
  'packages/@livestore/sync-cf',
  'packages/@livestore/utils',
  'packages/@livestore/utils-dev',
  'packages/@livestore/webmesh',
] as const

const generatedCheckProjects = generatedCheckProjectPaths.map((path) => {
  const project = workspaceProjectsByPath.get(path)
  if (project === undefined) {
    throw new Error(`missing check tsconfig project: ${path}`)
  }
  return project
})

// Examples deliberately remain standalone and are not Genie-managed. Their current
// root graph entries are check-only (noEmit projects or a solution-style config).
const standaloneExampleProjects: readonly RootTsconfigProject[] = [
  'examples/cloudflare-todomvc',
  'examples/tutorial-starter',
  'examples/web-email-client',
  'examples/web-linearlite',
  'examples/web-todomvc-script',
  'examples/web-todomvc',
  'examples/web-todomvc-sync-cf',
].map((path) => ({ path, tsconfig: undefined }))

export const rootTsconfigProjects = [...generatedCheckProjects, ...standaloneExampleProjects] as const
