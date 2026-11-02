/**
 * Production deploy workflow — operator-controlled stable docs promotion.
 *
 * After publishing a latest release, advance docs/stable to the release commit
 * via a reviewed PR, then dispatch docs, examples, and search from docs/stable.
 * Production surfaces must never build from unreleased main content.
 *
 * Operator deploy/recovery flow:
 *   gh workflow run deploy-prod.yml --ref docs/stable -f target=docs
 *   gh workflow run deploy-prod.yml --ref docs/stable -f target=examples
 *   gh workflow run deploy-prod.yml --ref docs/stable -f target=search
 *
 * Docs deploy has three bounded phases (build-deploy, verify, purge), with
 * timeout(1) and heartbeats at the OS boundary to reap orphan Chromium children.
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
} from '../../genie/repo.ts'

const TARGET_CHOICES = ['docs', 'examples', 'search', 'all'] as const

const withNixDiagnosticsOnFailure = (steps: unknown[]) => [...steps, nixDiagnosticsArtifactStep()]

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

const assertStableDocsRefStep = {
  name: 'Require stable docs source',
  run: `set -euo pipefail
if [ "$GITHUB_REF" != "refs/heads/docs/stable" ]; then
  echo "Production docs, examples, and search must be deployed from docs/stable." >&2
  exit 1
fi`,
}

export default githubWorkflow({
  name: 'Deploy production',
  actionlint: defaultActionlintConfig,

  on: {
    /**
     * Deploy the reviewed stable docs branch after npm/artifact publication,
     * or retry a failing target without re-running the publish chain.
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
        assertStableDocsRefStep,
        ...livestoreSetupSteps,
        otelSetupStep,
        {
          // Option A: a single `netlify deploy --build` runs the full
          // `@netlify/build` pipeline (framework build incl. snippets/diagrams +
          // serverless/edge bundling) and uploads, then writes deploy-state.json.
          name: 'Build + deploy docs to Netlify',
          run: runDevenvTasksBefore('docs:deploy:prod:phase:build-deploy'),
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
        assertStableDocsRefStep,
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
      needs: ['deploy-docs'],
      if: `\${{ !cancelled() && (needs.deploy-docs.result == 'success' || needs.deploy-docs.result == 'skipped') && (${targetGate('search')}) }}`,
      'runs-on': 'ubuntu-24.04',
      'timeout-minutes': 15,
      defaults: bashShellDefaults,
      steps: withNixDiagnosticsOnFailure([
        assertStableDocsRefStep,
        ...livestoreSetupSteps,
        {
          name: 'Sync production docs search',
          run: runDevenvTasksBefore('docs:search:sync:prod'),
          env: {
            MXBAI_API_KEY: '${{ secrets.MXBAI_API_KEY }}',
            MXBAI_VECTOR_STORE_ID_PROD: '${{ secrets.MXBAI_VECTOR_STORE_ID_PROD }}',
          },
        },
      ]),
    },
  },
})
