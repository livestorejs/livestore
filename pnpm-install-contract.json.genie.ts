import { projectionArtifact } from '#mr/effect-utils/genie/external.ts'

import rootPackageJson from './package.json.genie.ts'
import rootPnpmWorkspaceYaml from './pnpm-workspace.yaml.genie.ts'

const packageManager = rootPackageJson.data.packageManager ?? 'pnpm@unknown'
const pnpmVersion = packageManager.startsWith('pnpm@') ? packageManager.slice('pnpm@'.length) : packageManager
const workspaceData = rootPnpmWorkspaceYaml.data

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
