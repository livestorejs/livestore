import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { projectionArtifact } from '#mr/effect-utils/packages/@overeng/genie/src/runtime/projection-artifact/mod.ts'

import rootPackageJson from './package.json.genie.ts'
import rootPnpmWorkspaceYaml from './pnpm-workspace.yaml.genie.ts'

const packageManager = rootPackageJson.data.packageManager ?? 'pnpm@unknown'
const pnpmVersion = packageManager.startsWith('pnpm@') ? packageManager.slice('pnpm@'.length) : packageManager
const workspaceData = rootPnpmWorkspaceYaml.data
const megarepoLock = JSON.parse(readFileSync(`${process.cwd()}/megarepo.lock`, 'utf8')) as {
  members?: {
    'effect-utils'?: {
      ref?: string
      commit?: string
    }
  }
}
const effectUtilsLock = megarepoLock.members?.['effect-utils']

const semanticInputs = {
  sources: [
    'pnpm-install-contract.json.genie.ts',
    'package.json.genie.ts',
    'pnpm-workspace.yaml.genie.ts',
    'megarepo.lock members.effect-utils',
  ],
  generator: 'projectionArtifact.json from #mr/effect-utils/packages/@overeng/genie/src/runtime/projection-artifact/mod.ts',
  effectUtils: {
    ref: effectUtilsLock?.ref ?? 'unknown',
    commit: effectUtilsLock?.commit ?? 'unknown',
  },
  packageManager: {
    name: 'pnpm',
    version: pnpmVersion,
  },
  workspaceData: {
    allowBuilds: workspaceData.allowBuilds,
    allowUnusedPatches: workspaceData.allowUnusedPatches,
    dedupePeerDependents: workspaceData.dedupePeerDependents,
    enableGlobalVirtualStore: workspaceData.enableGlobalVirtualStore,
    ignoreScripts: workspaceData.ignoreScripts,
    injectWorkspacePackages: workspaceData.injectWorkspacePackages,
    minimumReleaseAgeExclude: workspaceData.minimumReleaseAgeExclude,
    optimisticRepeatInstall: workspaceData.optimisticRepeatInstall,
    packageExtensions: workspaceData.packageExtensions,
    packageImportMethod: workspaceData.packageImportMethod,
    packages: workspaceData.packages,
    patchedDependencies: workspaceData.patchedDependencies,
    peerDependencyRules: workspaceData.peerDependencyRules,
    pmOnFail: workspaceData.pmOnFail,
    sideEffectsCache: workspaceData.sideEffectsCache,
    storeDir: workspaceData.storeDir,
    strictPeerDependencies: workspaceData.strictPeerDependencies,
    strictStorePkgContentCheck: workspaceData.strictStorePkgContentCheck,
    supportedArchitectures: workspaceData.supportedArchitectures,
    verifyDepsBeforeRun: workspaceData.verifyDepsBeforeRun,
    verifyStoreIntegrity: workspaceData.verifyStoreIntegrity,
  },
} as const

const inputFingerprint = createHash('sha256').update(stableStringify(semanticInputs)).digest('hex')

export default projectionArtifact.json({
  schemaVersion: 1,
  data: {
    contract: 'effect-utils/pnpm-install-contract',
    packageManager: {
      name: 'pnpm',
      version: pnpmVersion,
    },
    storeContract: {
      owner: 'pnpm',
      layoutVersion: 'v11',
      storeDir: workspaceData.storeDir,
      sharedFilesStore: {
        enabledForLocalDev: true,
        disabledInCi: true,
      },
      globalVirtualStore: {
        enabled: workspaceData.enableGlobalVirtualStore,
      },
    },
    gvsLinkContract: {
      packageManager: {
        name: 'pnpm',
        version: pnpmVersion,
      },
      allowBuilds: workspaceData.allowBuilds,
      packageExtensions: workspaceData.packageExtensions,
    },
    installPolicy: {
      dedupePeerDependents: workspaceData.dedupePeerDependents,
      ignoreScripts: workspaceData.ignoreScripts,
      minimumReleaseAgeExclude: workspaceData.minimumReleaseAgeExclude,
      optimisticRepeatInstall: workspaceData.optimisticRepeatInstall,
      packageImportMethod: workspaceData.packageImportMethod,
      peerDependencyRules: workspaceData.peerDependencyRules,
      pmOnFail: workspaceData.pmOnFail,
      sideEffectsCache: workspaceData.sideEffectsCache,
      strictPeerDependencies: workspaceData.strictPeerDependencies,
      strictStorePkgContentCheck: workspaceData.strictStorePkgContentCheck,
      supportedArchitectures: workspaceData.supportedArchitectures,
      verifyDepsBeforeRun: workspaceData.verifyDepsBeforeRun,
      verifyStoreIntegrity: workspaceData.verifyStoreIntegrity,
    },
    workspaceManifestContract: {
      injectWorkspacePackages: workspaceData.injectWorkspacePackages,
      allowUnusedPatches: workspaceData.allowUnusedPatches,
      patchedDependencies: workspaceData.patchedDependencies,
      packages: workspaceData.packages,
    },
    metadata: {
      generatedArtifact: {
        generated: true,
        warning: 'DO NOT EDIT - changes will be overwritten',
        source: 'pnpm-install-contract.json.genie.ts',
        command: 'DT_PASSTHROUGH=1 genie',
        checkCommand: 'DT_PASSTHROUGH=1 genie --check',
        inputFingerprint,
        semanticInputs,
      },
      pnpmStoreOwnership: {
        filesLifecycle: 'pnpm-owned content-addressed files store',
        linksLifecycle: 'pnpm-owned rebuildable dependency-graph projection',
        projectsLifecycle: 'pnpm-owned store prune reachability registry',
      },
      nixIntegration: {
        liveInstallUsesGlobalVirtualStore: true,
        fixedOutputDependencyPrepUsesLiveGlobalVirtualStore: false,
      },
      buck2Integration: {
        consumeContractArtifact: true,
        avoidNodeModulesLayoutAsApi: true,
      },
    },
  },
})

function stableStringify(value: unknown): string {
  if (Array.isArray(value) === true) {
    return `[${value.map(stableStringify).join(',')}]`
  }

  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'undefined'
  }

  return `{${Object.entries(value as Record<string, unknown>)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([key, nestedValue]) => `${JSON.stringify(key)}:${stableStringify(nestedValue)}`)
    .join(',')}}`
}
