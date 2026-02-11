import {
  devenvShellDefaults,
  githubWorkflow,
  livestoreSetupSteps,
  livestoreSetupStepsAfterCheckout,
  namespaceRunner,
  otelSetupStep,
} from '../../genie/repo.ts'
import { playwrightSuites, syncProviderMatrix } from '../../genie/ci.ts'

// =============================================================================
// Shared Constants
// =============================================================================

const GITHUB_RUN_ID = '${{ github.run_id }}'
const GITHUB_SHA = '${{ github.sha }}'
const GITHUB_REF = '${{ github.ref }}'
const PR_HEAD_SHA = '${{ github.event.pull_request.head.sha || github.sha }}'
const IS_NOT_FORK = 'github.event.pull_request.head.repo.fork != true'

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

/** Standard CI job configuration (namespace runner + devenv shell) */
const standardCIJob = (config: { env?: Record<string, string>; steps: unknown[] }) => ({
  ...namespaceRunnerConfig,
  env: config.env,
  defaults: devenvShellDefaults,
  steps: config.steps,
})

/** OTEL-enabled CI job with Grafana Cloud export */
const otelCIJob = (config: { env?: Record<string, string>; steps: unknown[] }) =>
  standardCIJob({
    ...config,
    steps: [...livestoreSetupSteps, otelSetupStep, ...config.steps],
  })

/**
 * Flaky test wrapper that warns but doesn't fail.
 * TODO: Remove these once the underlying flakiness is resolved.
 */
const flakyTestStep = (name: string, command: string, issueUrl: string, warningMessage: string) => ({
  name,
  run: `if ${command}; then
  exit 0
else
  echo "::warning::${warningMessage} (flaky; see ${issueUrl} for details)"
  exit 0
fi`,
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
  },

  jobs: {
    lint: standardCIJob({
      steps: [...livestoreSetupSteps, { run: 'dt lint:full megarepo:check' }],
    }),

    'type-check': standardCIJob({
      steps: [...livestoreSetupSteps, { run: 'dt ts:build' }],
    }),

    'test-unit': standardCIJob({
      steps: [...livestoreSetupSteps, { run: 'dt test:unit' }],
    }),

    // TODO: Remove flaky test wrapper once node-sync flakiness is resolved
    // https://github.com/livestorejs/livestore/issues/624
    'test-integration-node-sync': otelCIJob({
      steps: [
        flakyTestStep(
          'Run node-sync integration tests',
          'dt test:integration:node-sync',
          'https://github.com/livestorejs/livestore/issues/624',
          'Node-sync integration tests failed',
        ),
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
          provider: [
            ...syncProviderMatrix,
          ],
        },
      },
      ...namespaceRunnerConfig,
      defaults: devenvShellDefaults,
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
          run: `if [[ "\${{ matrix.provider }}" == cf-* ]]; then
  if dt "test:integration:sync-provider:\${{ matrix.provider }}"; then
    exit 0
  else
    echo "::warning::Cloudflare sync-provider tests for \${{ matrix.provider }} failed (flaky; see https://github.com/livestorejs/livestore/issues/625 and upstream https://github.com/cloudflare/workers-sdk/issues/11122)"
    exit 0
  fi
else
  dt "test:integration:sync-provider:\${{ matrix.provider }}"
fi`,
        },
      ],
    },

    'test-integration-playwright': {
      strategy: {
        matrix: {
          suite: [...playwrightSuites],
        },
      },
      ...namespaceRunnerConfig,
      defaults: devenvShellDefaults,
      steps: [
        ...livestoreSetupSteps,
        otelSetupStep,
        {
          name: 'Run integration tests',
          env: { PLAYWRIGHT_SUITE: '${{ matrix.suite }}' },
          // TODO: fix flaky devtools test
          run: `if [ "\${{ matrix.suite }}" = "devtools" ]; then
  dt test:integration:devtools || echo "::warning::Script failed but continuing"
else
  dt "test:integration:\${{ matrix.suite }}"
fi`,
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
          run: `if [ -n "$NETLIFY_AUTH_TOKEN" ]; then
  bunx netlify-cli deploy --no-build --dir=tests/integration/playwright-report --site livestore-ci --filter @local/tests-integration --alias \${{ matrix.suite }}-$(git rev-parse --short HEAD)
else
  echo "Skipping Netlify deploy: NETLIFY_AUTH_TOKEN not set"
fi`,
        },
      ],
    },

    // Prefer a specific runner version for more consistent performance measurements between runs
    'perf-test': {
      'runs-on': 'ubuntu-24.04',
      defaults: devenvShellDefaults,
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
          run: 'dt test:perf',
          env: {
            COMMIT_SHA: PR_HEAD_SHA,
            GRAFANA_ENDPOINT: 'https://livestore.grafana.net',
            OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp-gateway-prod-us-east-2.grafana.net/otlp',
          },
        },
      ],
    },

    // Prefer a specific runner version for more consistent performance measurements between runs
    'wa-sqlite-test': {
      'runs-on': 'ubuntu-24.04',
      steps: [
        ...livestoreSetupSteps,
        otelSetupStep,
        {
          name: 'Build wa-sqlite',
          'working-directory': 'packages/@livestore/wa-sqlite',
          run: 'nix run .#build',
        },
        {
          name: 'Run wa-sqlite tests',
          run: 'devenv shell dt test:integration:wa-sqlite',
          env: {
            COMMIT_SHA: PR_HEAD_SHA,
            GRAFANA_ENDPOINT: 'https://livestore.grafana.net',
            OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp-gateway-prod-us-east-2.grafana.net/otlp',
          },
        },
      ],
    },

    'publish-snapshot-version': {
      if: IS_NOT_FORK,
      ...namespaceRunnerConfig,
      needs: [
        'test-unit',
        'test-integration-node-sync',
        'test-integration-sync-provider',
        'test-integration-playwright',
      ],
      defaults: devenvShellDefaults,
      steps: [
        ...livestoreSetupSteps,
        {
          name: 'Configure NPM authentication',
          run: 'echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" >> ~/.npmrc',
          env: { NPM_TOKEN: '${{ secrets.NPM_TOKEN }}' },
        },
        // Note: Using mono directly here because release:snapshot needs --git-sha parameter
        { run: `mono release snapshot --git-sha=${GITHUB_SHA}` },
      ],
    },

    'build-and-deploy-examples-src': {
      ...namespaceRunnerConfig,
      defaults: devenvShellDefaults,
      steps: [
        ...livestoreSetupSteps,
        {
          name: 'Install examples dependencies',
          // Run pnpm from root devenv shell, targeting examples workspace
          run: 'pnpm install --frozen-lockfile --dir examples',
        },
        {
          name: 'Build examples',
          // Run pnpm from root devenv shell, targeting examples workspace
          run: "pnpm --dir examples --filter 'livestore-example-*' --workspace-concurrency=1 build",
        },
        { name: 'Test examples', run: 'dt examples:test' },
        {
          name: 'Deploy examples to Cloudflare',
          if: IS_NOT_FORK,
          run: 'dt examples:deploy',
          env: {
            CLOUDFLARE_API_TOKEN: '${{ secrets.CLOUDFLARE_API_TOKEN }}',
            CLOUDFLARE_ACCOUNT_ID: '${{ secrets.CLOUDFLARE_ACCOUNT_ID }}',
          },
        },
      ],
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
      defaults: devenvShellDefaults,
      steps: [
        ...livestoreSetupSteps,
        { name: 'Build docs', run: 'dt docs:build:api' },
        {
          name: 'Deploy docs',
          if: `\${{ github.event_name != 'pull_request' || ${IS_NOT_FORK} }}`,
          run: 'dt docs:deploy',
          env: { NETLIFY_AUTH_TOKEN: '${{ secrets.NETLIFY_AUTH_TOKEN }}' },
        },
      ],
    },

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
        SNAPSHOT_VERSION: `0.0.0-snapshot-${GITHUB_SHA}`,
      },
      steps: [
        { name: 'Checkout repository', uses: 'actions/checkout@v4' },
        {
          // We're only using pnpm instead of the ./.github/actions/setup-env action
          // to simulate a simple, user-facing setup.
          name: 'Install dependencies',
          uses: 'pnpm/action-setup@v4',
          with: { standalone: true, run_install: true },
        },
        {
          name: "Get app's workspace dependencies",
          'working-directory': '${{ env.APP_PATH }}',
          run: `echo "WORKSPACE_DEPS=$( \\
  pnpm list --only-projects --json | \\
  jq -r '.[0].dependencies | keys | join(" ")' \\
)" >> $GITHUB_ENV`,
        },
        {
          /**
           * - We use `github.ref` instead of `github.sha` because, when a workflow is triggered by a pull request,
           *   `github.sha` refers to a temporary commit SHA that can become inaccessible in some contexts.
           * - We use `github.ref` instead of `github.ref_name` because GitHub's public API requires full refs.
           *   `github.ref_name` produces shortened refs like `123/merge` for PRs, which the API doesn't recognize.
           *   `github.ref` provides the full ref (e.g., `refs/pull/123/merge`) that the API understands.
           *
           * See https://www.kenmuse.com/blog/the-many-shas-of-a-github-pull-request/
           */
          name: 'Copy example app',
          run: `pnpm dlx @livestore/cli@\${{ env.SNAPSHOT_VERSION }} create --example \${{ matrix.app }} --ref ${GITHUB_REF} \${{ runner.temp }}/\${{ env.APP_PATH }}`,
        },
        {
          // Sometimes the snapshot version is not available immediately after publishing
          // due to network propagation delays. We increase the fetch retries to mitigate this.
          // See https://pnpm.io/settings#fetchretries
          name: 'Increase pnpm fetch retries',
          run: 'pnpm config set fetchRetries 3',
        },
        {
          name: 'Use snapshot version of workspace dependencies',
          'working-directory': '${{ runner.temp }}/${{ env.APP_PATH }}',
          run: `pnpm add $(
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
