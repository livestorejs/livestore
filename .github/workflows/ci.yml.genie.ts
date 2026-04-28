import { playwrightSuites, syncProviderMatrix } from '../../genie/ci.ts'
import {
  bashShellDefaults,
  defaultActionlintConfig,
  dispatchAlignmentStep,
  githubWorkflow,
  livestoreSetupSteps,
  livestoreSetupStepsAfterCheckout,
  namespaceRunner,
  nixDiagnosticsArtifactStep,
  otelSetupStep,
  repoPnpmOnlyBuiltDependencies,
  runDevenvTasksBefore,
  savePnpmStateStep,
} from '../../genie/repo.ts'

// =============================================================================
// Shared Constants
// =============================================================================

const GITHUB_RUN_ID = '${{ github.run_id }}'
const PR_HEAD_SHA = '${{ github.event.pull_request.head.sha || github.sha }}'
const IS_NOT_FORK = 'github.event.pull_request.head.repo.fork != true'
const DLX_ALLOW_BUILD_FLAGS = repoPnpmOnlyBuiltDependencies.map((name) => `--allow-build=${name}`).join(' ')
const PNPM_ADD_ALLOW_BUILD_FLAGS = repoPnpmOnlyBuiltDependencies.map((name) => `--allow-build=${name}`).join(' ')

// =============================================================================
// Job Helpers
// =============================================================================

/**
 * Standard namespace runner with run ID-based affinity.
 *
 * By default, any runner with matching labels can pick up any waiting job, even from different
 * workflow runs. This causes jobs from newer runs to "jump the queue" ahead of older runs when
 * hitting concurrency limits, resulting in longer workflow run times. Adding the run ID as a
 * label creates runner affinity: runners spawned for this workflow run can only execute jobs
 * from this same run, ensuring older workflow runs finish before newer ones consume runner
 * capacity.
 */
const namespaceRunnerConfig = {
  'runs-on': namespaceRunner(GITHUB_RUN_ID),
}

const withNixDiagnosticsOnFailure = (steps: unknown[]) => [
  ...steps,
  savePnpmStateStep({ keyPrefix: 'livestore-pnpm-state-v1' }),
  nixDiagnosticsArtifactStep(),
]

/** Standard CI job configuration (namespace runner + bash shell) */
const standardCIJob = (config: { env?: Record<string, string>; steps: unknown[] }) => ({
  ...namespaceRunnerConfig,
  env: config.env,
  defaults: bashShellDefaults,
  steps: withNixDiagnosticsOnFailure(config.steps),
})

/** OTEL-enabled CI job with Grafana Cloud export */
const otelCIJob = (config: { env?: Record<string, string>; steps: unknown[] }) =>
  standardCIJob({
    ...config,
    steps: [...livestoreSetupSteps, otelSetupStep, ...config.steps],
  })

// =============================================================================
// Workflow Definition
// =============================================================================

/**
 * Required status checks are managed by `.github/repo-settings.*.json.genie.ts`.
 * Keep matrix values aligned with `genie/ci.ts` so rulesets and workflow stay in sync.
 */
export default githubWorkflow({
  name: 'ci',
  'run-name': `\${{ github.event.pull_request.title || format('Push to {0}', github.ref_name) }} (${PR_HEAD_SHA})`,
  actionlint: defaultActionlintConfig,

  permissions: {
    'id-token': 'write',
    contents: 'read',
  },

  on: {
    push: {
      // Only run on pushes to main/dev to keep docs deploys consistent
      branches: ['main', 'dev'],
    },
    pull_request: {},
  },

  env: {
    GITHUB_BRANCH_NAME: '${{ github.head_ref || github.ref_name }}',
    CACHIX_AUTH_TOKEN: '${{ secrets.CACHIX_AUTH_TOKEN }}',
    FORCE_SETUP: '1',
    CI: 'true',
  },

  jobs: {
    lint: standardCIJob({
      steps: [
        ...livestoreSetupSteps,
        { name: 'Run lint checks', run: runDevenvTasksBefore('lint:full:with-megarepo-check') },
      ],
    }),

    'type-check': standardCIJob({
      // TODO(oep-1n3.9): Switch back to patched tsc once Effect diagnostics backlog is addressed.
      steps: [...livestoreSetupSteps, { name: 'Run type-check', run: runDevenvTasksBefore('ts:build') }],
    }),

    'test-unit': standardCIJob({
      steps: [...livestoreSetupSteps, { name: 'Run unit tests', run: runDevenvTasksBefore('test:unit') }],
    }),

    // TODO: Remove flaky test wrapper once node-sync flakiness is resolved
    // https://github.com/livestorejs/livestore/issues/624
    'test-integration-node-sync': otelCIJob({
      steps: [
        {
          name: 'Run node-sync integration tests',
          run: runDevenvTasksBefore('test:integration:node-sync:allow-flaky'),
        },
        {
          name: 'Display node-sync logs',
          if: 'always()',
          run: `if [ -d "tests/integration/tmp/logs" ]; then
  echo "::group::Node-sync test logs"
  for log_file in tests/integration/tmp/logs/*.log; do
    if [ -f "$log_file" ]; then
      echo "::group::$(basename "$log_file")"
      cat "$log_file"
      echo "::endgroup::"
    fi
  done
  echo "::endgroup::"
else
  echo "No log files found"
fi`,
        },
        {
          uses: 'actions/upload-artifact@v4',
          if: 'always()',
          with: {
            name: 'node-sync-logs',
            path: 'tests/integration/tmp/logs/',
            'retention-days': 30,
          },
        },
      ],
    }),

    // TODO: Remove Cloudflare workaround once upstream issues are resolved:
    // - Upstream: https://github.com/cloudflare/workers-sdk/issues/11122 (Durable object hanging tests)
    // - LiveStore tracking: https://github.com/livestorejs/livestore/issues/625
    'test-integration-sync-provider': {
      strategy: {
        matrix: {
          provider: [...syncProviderMatrix],
        },
      },
      ...namespaceRunnerConfig,
      defaults: bashShellDefaults,
      steps: [
        ...livestoreSetupSteps,
        otelSetupStep,
        {
          name: 'Start s2-lite container',
          if: "${{ matrix.provider == 's2' }}",
          run: `docker run -d --name s2-lite -p 4566:80 ghcr.io/s2-streamstore/s2 lite
# Wait for s2-lite to be ready
for i in {1..30}; do
  if curl -sf http://localhost:4566/ping > /dev/null 2>&1; then
    echo "s2-lite is ready"
    break
  fi
  echo "Waiting for s2-lite... ($i/30)"
  sleep 1
done`,
          shell: 'bash',
        },
        {
          name: 'Run sync-provider tests for ${{ matrix.provider }}',
          run: runDevenvTasksBefore('test:integration:sync-provider:matrix'),
          env: { OTEL_STATE_DIR: '', TEST_SYNC_PROVIDER: '${{ matrix.provider }}' },
        },
        savePnpmStateStep({ keyPrefix: 'livestore-pnpm-state-v1' }),
        nixDiagnosticsArtifactStep(),
      ],
    },

    'test-integration-playwright': {
      strategy: {
        matrix: {
          suite: [...playwrightSuites],
        },
      },
      ...namespaceRunnerConfig,
      defaults: bashShellDefaults,
      steps: [
        ...livestoreSetupSteps,
        otelSetupStep,
        {
          name: 'Run integration tests',
          env: { PLAYWRIGHT_SUITE: '${{ matrix.suite }}' },
          run: runDevenvTasksBefore('test:integration:playwright:suite'),
        },
        {
          uses: 'actions/upload-artifact@v4',
          if: '${{ !cancelled() }}',
          with: {
            name: 'playwright-report-${{ matrix.suite }}',
            path: 'tests/integration/playwright-report/',
            'retention-days': 30,
          },
        },
        {
          // TODO: surface deploy url in github UI via environments
          name: 'Upload trace',
          if: '${{ !cancelled() }}',
          env: {
            NETLIFY_AUTH_TOKEN: '${{ secrets.NETLIFY_AUTH_TOKEN }}',
            PLAYWRIGHT_SUITE: '${{ matrix.suite }}',
          },
          run: runDevenvTasksBefore('test:integration:playwright:upload-trace'),
        },
        savePnpmStateStep({ keyPrefix: 'livestore-pnpm-state-v1' }),
        nixDiagnosticsArtifactStep(),
      ],
    },

    // Run on namespace runners to align CI environment with the rest of the test matrix.
    'perf-test': {
      ...namespaceRunnerConfig,
      defaults: bashShellDefaults,
      steps: [
        {
          // See https://github.com/orgs/community/discussions/26325
          name: 'Checkout code',
          uses: 'actions/checkout@v4',
          with: { ref: PR_HEAD_SHA },
        },
        ...livestoreSetupStepsAfterCheckout,
        otelSetupStep,
        {
          name: 'Run performance tests',
          run: runDevenvTasksBefore('test:perf'),
          env: {
            COMMIT_SHA: PR_HEAD_SHA,
            GRAFANA_ENDPOINT: 'https://livestore.grafana.net',
            OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp-gateway-prod-us-east-2.grafana.net/otlp',
          },
        },
        savePnpmStateStep({ keyPrefix: 'livestore-pnpm-state-v1' }),
        nixDiagnosticsArtifactStep(),
      ],
    },

    // Run on namespace runners to align CI environment with the rest of the test matrix.
    'wa-sqlite-test': {
      ...namespaceRunnerConfig,
      defaults: bashShellDefaults,
      steps: [
        ...livestoreSetupSteps,
        otelSetupStep,
        { name: 'Build wa-sqlite', run: runDevenvTasksBefore('test:integration:wa-sqlite:build') },
        {
          name: 'Run wa-sqlite tests',
          run: runDevenvTasksBefore('test:integration:wa-sqlite'),
          env: {
            COMMIT_SHA: PR_HEAD_SHA,
            GRAFANA_ENDPOINT: 'https://livestore.grafana.net',
            OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp-gateway-prod-us-east-2.grafana.net/otlp',
          },
        },
        savePnpmStateStep({ keyPrefix: 'livestore-pnpm-state-v1' }),
        nixDiagnosticsArtifactStep(),
      ],
    },

    /**
     * Publish job runs on GitHub-hosted runner (not Namespace) because npm OIDC
     * trusted publishing with --provenance requires sigstore, which only supports
     * GitHub-hosted runners.
     */
    'publish-snapshot-version': {
      if: IS_NOT_FORK,
      'runs-on': 'ubuntu-24.04',
      needs: [
        'test-unit',
        'test-integration-node-sync',
        'test-integration-sync-provider',
        'test-integration-playwright',
      ],
      defaults: bashShellDefaults,
      steps: withNixDiagnosticsOnFailure([
        ...livestoreSetupSteps,
        {
          name: 'Publish snapshot version',
          run: runDevenvTasksBefore('release:snapshot:git-sha'),
          env: { GIT_SHA: PR_HEAD_SHA },
        },
        {
          name: 'Publish DevTools artifact snapshot',
          run: runDevenvTasksBefore('release:devtools-artifact:publish'),
          env: { LIVESTORE_RELEASE_VERSION: `0.0.0-snapshot-${PR_HEAD_SHA}` },
        },
      ]),
    },

    'build-and-deploy-examples-src': {
      ...namespaceRunnerConfig,
      defaults: bashShellDefaults,
      steps: withNixDiagnosticsOnFailure([
        ...livestoreSetupSteps,
        {
          name: 'Install examples dependencies',
          run: runDevenvTasksBefore('examples:install'),
        },
        {
          name: 'Build examples',
          run: runDevenvTasksBefore('examples:build:src'),
        },
        { name: 'Test examples', run: runDevenvTasksBefore('examples:test') },
        {
          name: 'Deploy examples to Cloudflare',
          if: IS_NOT_FORK,
          run: runDevenvTasksBefore('examples:deploy'),
          env: {
            CLOUDFLARE_API_TOKEN: '${{ secrets.CLOUDFLARE_API_TOKEN }}',
            CLOUDFLARE_ACCOUNT_ID: '${{ secrets.CLOUDFLARE_ACCOUNT_ID }}',
          },
        },
      ]),
    },

    /**
     * Docs deployment mapping (authoritative, with domains) — handled by `mono docs deploy`:
     * - pull_request (any base): deploy alias on dev docs site (no purge)
     *     example domain: https://<alias>--livestore-docs-dev.netlify.app
     * - push to dev: deploy to dev docs site as prod
     *     domain: https://dev.docs.livestore.dev
     * - push to main: deploy to prod docs site as prod
     *     domain: https://docs.livestore.dev
     * `mono docs deploy` applies filter="docs" and infers context from GitHub env.
     */
    'build-deploy-docs': {
      ...namespaceRunnerConfig,
      defaults: bashShellDefaults,
      steps: withNixDiagnosticsOnFailure([
        ...livestoreSetupSteps,
        // TODO(oep-bbd): Restore once root cause is fixed and diagnostics are removed.
        // { name: 'Build docs', run: runDevenvTasksBefore('docs:build:api') },
        // TODO(oep-bbd): Temporary phase split + hard timeouts for docs CI hang triage.
        // Remove once root cause is fixed. Bead context: tasks/2026/02/refactor--genie-igor-ci/oep-bbd/problem.md
        {
          name: 'Build docs snippets',
          run: runDevenvTasksBefore('docs:build:phase:snippets'),
        },
        // TODO(oep-bbd): Temporary diagnostics step for docs CI hang triage.
        // Remove once root cause is fixed. Bead context: tasks/2026/02/refactor--genie-igor-ci/oep-bbd/problem.md
        {
          name: 'Build docs diagrams',
          run: runDevenvTasksBefore('docs:build:phase:diagrams'),
        },
        // TODO(oep-bbd): Temporary heartbeat/process logging for Astro build visibility.
        // Remove once root cause is fixed. Bead context: tasks/2026/02/refactor--genie-igor-ci/oep-bbd/problem.md
        {
          name: 'Build Astro docs bundle',
          run: runDevenvTasksBefore('docs:build:phase:astro'),
        },
        // TODO(oep-bbd): Temporary failure-time process dump for docs CI hang triage.
        // Remove once root cause is fixed. Bead context: tasks/2026/02/refactor--genie-igor-ci/oep-bbd/problem.md
        {
          name: 'Collect docs build diagnostics on failure',
          if: '${{ failure() }}',
          run: runDevenvTasksBefore('docs:build:diagnostics'),
        },
        // TODO(oep-bbd): Temporary artifact upload for docs CI diagnostics.
        // Remove once root cause is fixed. Bead context: tasks/2026/02/refactor--genie-igor-ci/oep-bbd/problem.md
        {
          name: 'Upload docs build logs',
          if: '${{ always() }}',
          uses: 'actions/upload-artifact@v4',
          with: {
            name: 'docs-build-logs',
            path: 'tmp/ci-docs/',
            'retention-days': 14,
          },
        },
        {
          name: 'Deploy docs',
          if: `\${{ success() && (github.event_name != 'pull_request' || ${IS_NOT_FORK}) }}`,
          run: runDevenvTasksBefore('docs:deploy'),
          env: { NETLIFY_AUTH_TOKEN: '${{ secrets.NETLIFY_AUTH_TOKEN }}' },
        },
      ]),
    },

    // TODO(#1183): Disable notify job until root cause is fixed.
    // 'notify-alignment': {
    //   'runs-on': 'ubuntu-latest',
    //   needs: [
    //     'test-unit',
    //     'test-integration-node-sync',
    //     'test-integration-sync-provider',
    //     'test-integration-playwright',
    //   ],
    //   if: "(github.ref == 'refs/heads/main' || github.ref == 'refs/heads/dev') && github.event_name == 'push'",
    //   steps: [dispatchAlignmentStep({ targetRepo: 'schickling/megarepo-all' })],
    // },

    'build-example-create': {
      if: IS_NOT_FORK,
      needs: 'publish-snapshot-version',
      strategy: {
        matrix: {
          app: ['web-todomvc', 'web-linearlite', 'expo-linearlite'],
        },
      },
      ...namespaceRunnerConfig,
      env: {
        APP_PATH: 'examples/${{ matrix.app }}',
        SNAPSHOT_VERSION: `0.0.0-snapshot-${PR_HEAD_SHA}`,
      },
      steps: [
        { name: 'Checkout repository', uses: 'actions/checkout@v4' },
        {
          // We're only using pnpm instead of the ./.github/actions/setup-env action
          // to simulate a simple, user-facing setup.
          name: 'Setup pnpm',
          uses: 'pnpm/action-setup@v4',
          with: { standalone: true },
        },
        {
          /** Only include @livestore/* deps that exist in this workspace (excludes externally-published packages like devtools-vite) */
          name: "Get app's workspace @livestore dependencies",
          run: `DEPS=$(jq -r '[(.dependencies // {}), (.devDependencies // {}) | to_entries[] | select(.key | startswith("@livestore/")) | .key] | .[]' \${{ env.APP_PATH }}/package.json | while read dep; do dir="packages/@livestore/\${dep#@livestore/}"; [ -d "$dir" ] && echo "$dep"; done | tr '\\n' ' ')
echo "WORKSPACE_DEPS=$DEPS" >> $GITHUB_ENV`,
        },
        {
          /**
           * Use PR head SHA for pull_request events. `refs/pull/<id>/merge` can be missing when
           * merge commits are unavailable, which makes GitHub contents API calls fail.
           */
          name: 'Copy example app',
          run: `pnpm dlx ${DLX_ALLOW_BUILD_FLAGS} @livestore/cli@\${{ env.SNAPSHOT_VERSION }} create --example \${{ matrix.app }} --ref ${PR_HEAD_SHA} \${{ runner.temp }}/\${{ env.APP_PATH }}`,
        },
        {
          name: 'Use snapshot version of workspace dependencies',
          'working-directory': '${{ runner.temp }}/${{ env.APP_PATH }}',
          run: `pnpm add ${PNPM_ADD_ALLOW_BUILD_FLAGS} $(
  for dep in $WORKSPACE_DEPS; do
    echo "$dep@\${{ env.SNAPSHOT_VERSION }}"
  done
)`,
        },
        {
          // TODO: build expo app with EAS
          if: "${{ matrix.app != 'expo-linearlite' }}",
          'working-directory': '${{ runner.temp }}/${{ env.APP_PATH }}',
          run: 'pnpm build',
        },
      ],
    },
  },
})
