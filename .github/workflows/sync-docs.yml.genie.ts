/**
 * Docs search index sync.
 *
 * Each docs surface owns its own Mixedbread vector store (LS.DOCS.SEARCH-R03),
 * so a reader only ever gets hits for pages the surface they are on actually
 * serves: `dev` tracks `main`, `prod` tracks the published stable release.
 *
 * This workflow was the repo's last hand-written one, and drifted for exactly
 * that reason: it pinned pnpm via `pnpm/action-setup` while `packageManager`
 * moved to 11.8.0, so every run died at environment setup and the index went
 * unrefreshed for months. It now uses `livestoreSetupSteps` like every other
 * workflow, and calls the `docs:search:sync:*` devenv tasks rather than
 * invoking the Mixedbread CLI inline, so there is one way to run a sync.
 *
 * Target selection is two gated jobs rather than a shell branch on an env var.
 * The previous single-step form silently fell back to a legacy store id when
 * its target's secret was unset, which is how a prod sync ended up writing the
 * dev store.
 */
import {
  bashShellDefaults,
  githubWorkflow,
  livestoreSetupSteps,
  nixDiagnosticsArtifactStep,
  runDevenvTasksBefore,
  savePnpmStateStep,
} from '../../genie/repo.ts'

const withNixDiagnosticsOnFailure = (steps: unknown[]) => [
  ...steps,
  savePnpmStateStep({ keyPrefix: 'livestore-pnpm-state-v1' }),
  nixDiagnosticsArtifactStep(),
]

/** A push to `main` only ever refreshes the dev index; prod is release-gated. */
const isDevTarget = "github.event_name == 'push' || inputs.target == 'dev'"
const isProdTarget = "github.event_name == 'workflow_dispatch' && inputs.target == 'prod'"

const syncJob = ({ gate, task, env }: { gate: string; task: string; env: Record<string, string> }) => ({
  if: `\${{ ${gate} }}`,
  'runs-on': 'ubuntu-24.04',
  'timeout-minutes': 20,
  defaults: bashShellDefaults,
  steps: withNixDiagnosticsOnFailure([
    ...livestoreSetupSteps,
    {
      name: 'Sync docs search index',
      run: runDevenvTasksBefore(task),
      env: {
        MXBAI_API_KEY: '${{ secrets.MXBAI_API_KEY }}',
        ...env,
      },
    },
  ]),
})

export default githubWorkflow({
  name: 'Sync docs to Mixedbread Vector Store',
  on: {
    workflow_dispatch: {
      inputs: {
        target: {
          description: 'Docs search target to sync',
          required: true,
          default: 'dev',
          type: 'choice',
          options: ['dev', 'prod'],
        },
      },
    },
    push: {
      branches: ['main'],
      paths: ['docs/src/content/**/*.md', 'docs/src/content/**/*.mdx'],
    },
  },
  concurrency: {
    group: '${{ github.workflow }}-${{ github.ref }}',
    'cancel-in-progress': true,
  },
  jobs: {
    'sync-dev': syncJob({
      gate: isDevTarget,
      task: 'docs:search:sync:dev',
      env: { MXBAI_VECTOR_STORE_ID_DEV: '${{ secrets.MXBAI_VECTOR_STORE_ID_DEV }}' },
    }),
    'sync-prod': syncJob({
      gate: isProdTarget,
      task: 'docs:search:sync:prod',
      env: { MXBAI_VECTOR_STORE_ID_PROD: '${{ secrets.MXBAI_VECTOR_STORE_ID_PROD }}' },
    }),
  },
})
