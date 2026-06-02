/**
 * Production deploy workflow — operator recovery entry point.
 *
 * Hoisted out of `release.yml#publish-release` so each prod deploy target
 * (docs, examples, search index) can be re-dispatched independently when a
 * publish-release run has already succeeded the npm/DevTools-artifact stages
 * but a downstream deploy hangs or fails.
 *
 * Trigger: `workflow_dispatch` only. The forward orchestration spine lives in
 * `release.yml#publish-release`, which runs the same per-phase Nix tasks
 * inline so dev-tag releases and stable releases follow the same code path.
 * The reason this file isn't called from `release.yml` via `workflow_call` is
 * that the genie workflow schema does not yet support reusable-workflow `uses:`
 * jobs (see livestorejs/livestore#1279 for context).
 *
 * Operator recovery flow (e.g. docs deploy hangs on orphan Chromium):
 *   gh workflow run deploy-prod.yml -f target=docs
 *
 * Docs deploy is intentionally split into 6 phases (snippets, diagrams, astro,
 * upload, verify, purge), each with its own `timeout(1)` + heartbeat at the
 * OS boundary. The shell-level cap reaps orphan child processes (PID-tree kill
 * on SIGKILL) that Effect-level timeouts cannot reach.
 */
import {
  bashShellDefaults,
  defaultActionlintConfig,
  githubWorkflow,
  livestoreDefaultRefPolicyJob,
  livestoreSetupSteps,
  nixDiagnosticsArtifactStep,
  otelSetupStep,
  runDevenvTasksBefore,
  savePnpmStateStep,
} from '../../genie/repo.ts'

const TARGET_CHOICES = ['docs', 'examples', 'search', 'all'] as const

const withNixDiagnosticsOnFailure = (steps: unknown[]) => [
  ...steps,
  savePnpmStateStep({ keyPrefix: 'livestore-pnpm-state-v1' }),
  nixDiagnosticsArtifactStep(),
]

/**
 * Upload the per-phase logs under `tmp/ci-docs-prod/` so post-mortem of a
 * deploy hang has the heartbeat trace, process listing, and deploy-state file.
 * Retention is short — these are debugging aids, not release evidence.
 */
const docsProdLogsArtifactStep = {
  name: 'Upload docs prod deploy logs',
  if: '${{ always() }}',
  uses: 'actions/upload-artifact@v4',
  with: {
    name: 'docs-prod-deploy-logs-${{ github.run_id }}-${{ github.run_attempt }}',
    path: 'tmp/ci-docs-prod/',
    'if-no-files-found': 'ignore',
    'retention-days': 14,
  },
}

const targetGate = (target: 'docs' | 'examples' | 'search') => `inputs.target == '${target}' || inputs.target == 'all'`

export default githubWorkflow({
  name: 'Deploy production',
  actionlint: defaultActionlintConfig,

  on: {
    /**
     * Operator recovery: if docs/examples/search deploy fails or hangs after
     * `release.yml#publish-release` has already published the npm packages and
     * DevTools artifact, the maintainer dispatches this workflow with the
     * failing target instead of re-running the entire publish chain.
     */
    workflow_dispatch: {
      inputs: {
        target: {
          description: 'Which prod surface(s) to deploy',
          required: true,
          type: 'choice',
          default: 'all',
          options: [...TARGET_CHOICES],
        },
      },
    },
  },

  permissions: {
    contents: 'read',
    'id-token': 'write',
  },

  env: {
    CACHIX_AUTH_TOKEN: '${{ secrets.CACHIX_AUTH_TOKEN }}',
    CI: 'true',
    FORCE_SETUP: '1',
  },

  jobs: {
    'source-policy': livestoreDefaultRefPolicyJob,

    /**
     * Docs prod deploy — phase-split single job.
     *
     * Each phase is a separate step (not a separate job) so they share the
     * Nix store, pnpm cache, and the on-disk Astro build output. A single
     * `timeout-minutes` cap on the job is a backstop above the per-phase
     * `timeout(1)` calls in `mono-wrappers.nix`.
     */
    'deploy-docs': {
      if: `\${{ ${targetGate('docs')} }}`,
      'runs-on': 'ubuntu-24.04',
      'timeout-minutes': 90,
      defaults: bashShellDefaults,
      steps: withNixDiagnosticsOnFailure([
        ...livestoreSetupSteps,
        otelSetupStep,
        {
          name: 'Build docs snippets',
          run: runDevenvTasksBefore('docs:deploy:prod:phase:snippets'),
        },
        {
          name: 'Build docs diagrams',
          run: runDevenvTasksBefore('docs:deploy:prod:phase:diagrams'),
        },
        {
          name: 'Build Astro docs bundle',
          run: runDevenvTasksBefore('docs:deploy:prod:phase:astro'),
        },
        {
          name: 'Upload docs to Netlify',
          run: runDevenvTasksBefore('docs:deploy:prod:phase:upload'),
          env: {
            NETLIFY_AUTH_TOKEN: '${{ secrets.NETLIFY_AUTH_TOKEN }}',
          },
        },
        {
          name: 'Verify docs deploy',
          run: runDevenvTasksBefore('docs:deploy:prod:phase:verify'),
          env: {
            NETLIFY_AUTH_TOKEN: '${{ secrets.NETLIFY_AUTH_TOKEN }}',
          },
        },
        {
          name: 'Purge Netlify CDN',
          run: runDevenvTasksBefore('docs:deploy:prod:phase:purge'),
          env: {
            NETLIFY_AUTH_TOKEN: '${{ secrets.NETLIFY_AUTH_TOKEN }}',
          },
        },
        {
          name: 'Collect docs deploy diagnostics on failure',
          if: '${{ failure() }}',
          run: runDevenvTasksBefore('docs:deploy:prod:diagnostics'),
        },
        docsProdLogsArtifactStep,
      ]),
    },

    'deploy-examples': {
      if: `\${{ ${targetGate('examples')} }}`,
      'runs-on': 'ubuntu-24.04',
      'timeout-minutes': 30,
      defaults: bashShellDefaults,
      steps: withNixDiagnosticsOnFailure([
        ...livestoreSetupSteps,
        otelSetupStep,
        {
          name: 'Deploy production examples',
          run: runDevenvTasksBefore('examples:deploy:prod'),
          env: {
            CLOUDFLARE_API_TOKEN: '${{ secrets.CLOUDFLARE_API_TOKEN }}',
            CLOUDFLARE_ACCOUNT_ID: '${{ secrets.CLOUDFLARE_ACCOUNT_ID }}',
          },
        },
      ]),
    },

    'deploy-search': {
      if: `\${{ ${targetGate('search')} }}`,
      'runs-on': 'ubuntu-24.04',
      'timeout-minutes': 15,
      defaults: bashShellDefaults,
      steps: withNixDiagnosticsOnFailure([
        ...livestoreSetupSteps,
        {
          name: 'Sync production docs search',
          run: `set -euo pipefail
: "\${MXBAI_API_KEY:?Missing MXBAI_API_KEY secret}"
: "\${MXBAI_VECTOR_STORE_ID_PROD:?Missing MXBAI_VECTOR_STORE_ID_PROD secret}"
pnpm --dir docs exec mxbai store sync "$MXBAI_VECTOR_STORE_ID_PROD" "./src/content/**/*.mdx" "./src/content/**/*.md" --yes --strategy fast`,
          env: {
            MXBAI_API_KEY: '${{ secrets.MXBAI_API_KEY }}',
            MXBAI_VECTOR_STORE_ID_PROD: '${{ secrets.MXBAI_VECTOR_STORE_ID_PROD }}',
          },
        },
      ]),
    },
  },
})
