import { projectionArtifact } from './genie/repo.ts'
import rootPackageJson from './package.json.genie.ts'
import rootPnpmWorkspaceYaml from './pnpm-workspace.yaml.genie.ts'

/**
 * Root pnpm install contract consumed by effect-utils' shared pnpm task module
 * (`nix/devenv-modules/tasks/shared/pnpm.nix`). It captures LiveStore's pnpm
 * install/store policy so the module can hash the install-relevant surface
 * (`gvsLinkContract`) and classify contract drift across the `identityInputs`
 * sections. Every field is derived from LiveStore's own workspace + root
 * package data — no effect-utils values are hardcoded.
 *
 * Fields LiveStore intentionally does not set are omitted from the generated
 * JSON (undefined keys are dropped on serialization):
 * - `installPolicy.peerDependencyRules`: LiveStore drops the shared Effect-v3
 *   peer suppressions so stale peers fail loudly during the v4 migration
 *   (see `pnpm-workspace.yaml.genie.ts`).
 * - `workspaceManifestContract.patchedDependencies` / `allowUnusedPatches`:
 *   LiveStore ships no pnpm patches.
 */
const packageManager = rootPackageJson.data.packageManager ?? 'pnpm@unknown'
const pnpmVersion = packageManager.startsWith('pnpm@') ? packageManager.slice('pnpm@'.length) : packageManager
const workspaceData = rootPnpmWorkspaceYaml.data

export default projectionArtifact.json({
  schemaVersion: 1,
  data: {
    contract: 'livestore/pnpm-install-contract',
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
    dependencyMaterializationProfile: {
      schema: 'dependency-materialization-profile/v0',
      identityInputs: [
        'packageManager',
        'gvsLinkContract',
        'installPolicy',
        'storeContract',
        'workspaceManifestContract',
      ],
      supportedTraits: {
        ciJobLocal: {
          mutableState: 'job-local',
          gcAuthority: 'profile-local',
          repairAuthority: 'ci-job',
        },
        darwinSplitCas: {
          mutableState: 'profile-local',
          sharedContent: 'store/v11/files',
          gcAuthority: 'shared-pool-coordinator',
          repairAuthority: 'devenv',
        },
        isolated: {
          mutableState: 'profile-local',
          gcAuthority: 'profile-local',
          repairAuthority: 'devenv',
        },
        nixPreparedDeps: {
          mutableState: 'none',
          gcAuthority: 'nix-store',
          repairAuthority: 'evergreen-fod',
        },
      },
      nativeBuildPolicyInputs: {
        allowBuilds: 'gvsLinkContract.allowBuilds',
        compilerEnv: ['CC', 'CXX'],
      },
      buck2Boundary: {
        consumesEvidence: true,
        ownsLiveMaterialization: false,
      },
    },
  },
})
