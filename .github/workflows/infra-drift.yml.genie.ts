/**
 * Infrastructure drift detection.
 *
 * A declaration nobody checks is documentation, not a control: the value of
 * `.infra/iac/` is that a change made outside it becomes visible. Nothing in
 * the repo ran `plan`, so this job does — on a schedule, and on any push that
 * touches the config.
 *
 * `infra:netlify:drift-check` runs `tofu plan -detailed-exitcode`, so drift
 * exits non-zero and turns the job red rather than printing a diff nobody
 * reads.
 *
 * Secrets rather than op-proxy: the IaC preamble prefers already-set `TF_VAR_*`
 * env vars and only falls back to 1Password, so CI supplies them directly.
 * Scheduled and push-triggered only — never `pull_request`, because fork PRs
 * receive no secrets and would fail for a reason unrelated to drift.
 */
import {
  bashShellDefaults,
  githubWorkflow,
  livestoreSetupSteps,
  nixDiagnosticsArtifactStep,
  runDevenvTasksBefore,
  savePnpmStateStep,
} from '../../genie/repo.ts'

export default githubWorkflow({
  name: 'Infrastructure drift',
  on: {
    schedule: [{ cron: '0 7 * * 1-5' }],
    workflow_dispatch: {},
    push: {
      branches: ['main'],
      paths: ['.infra/iac/**'],
    },
  },
  concurrency: {
    group: '${{ github.workflow }}',
    'cancel-in-progress': false,
  },
  jobs: {
    'netlify-drift': {
      'runs-on': 'ubuntu-24.04',
      'timeout-minutes': 20,
      defaults: bashShellDefaults,
      steps: [
        ...livestoreSetupSteps,
        {
          name: 'Check Netlify env-var drift',
          run: runDevenvTasksBefore('infra:netlify:drift-check'),
          env: {
            NETLIFY_AUTH_TOKEN: '${{ secrets.NETLIFY_AUTH_TOKEN }}',
            TF_VAR_state_encryption_passphrase: '${{ secrets.TOFU_STATE_ENCRYPTION_PASSPHRASE }}',
            TF_VAR_mxbai_api_key: '${{ secrets.MXBAI_API_KEY }}',
          },
        },
        savePnpmStateStep({ keyPrefix: 'livestore-pnpm-state-v1' }),
        nixDiagnosticsArtifactStep(),
      ],
    },
  },
})
