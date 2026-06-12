import { playwrightSuites, syncProviderMatrix } from '../../genie/ci.ts'
import {
  bashShellDefaults,
  defaultActionlintConfig,
  dispatchAlignmentStep,
  githubWorkflow,
  livestoreDefaultRefPolicyJob,
  livestoreSetupSteps,
  livestoreSetupStepsAfterCheckout,
  namespaceRunner,
  nixDiagnosticsArtifactStep,
  otelSetupStep,
  repoPnpmOnlyBuiltDependencies,
  runDevenvTasksBefore,
  savePnpmStateStep,
  workflowReportCollectorStep,
  workflowReportCommentBodyStep,
  workflowReportProducerStep,
  workflowReportPublisherStep,
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
// PR Preview Workflow Report
// =============================================================================

/**
 * Surface PR-time deploy/publish outcomes (npm snapshot, docs preview, examples
 * previews) as a single managed PR comment. Each producer job writes one or
 * more JSONL records to its own artifact; the dedicated `report-pr-preview`
 * job aggregates every artifact into one bundle and upserts the comment.
 *
 * Records are deduped by `subject.id` downstream, so each producer owns a
 * stable subject (`livestore-npm-snapshot`, `livestore-docs-preview`,
 * `livestore-example-<slug>`) and contributors see the latest URL per surface.
 */
const PR_PREVIEW_REPORT_STATE_ID = 'pr-preview'

const SNAPSHOT_REPORT_ARTIFACT_NAME = 'snapshot-publish-workflow-report'
const SNAPSHOT_REPORT_RECORD_PATH = '${{ runner.temp }}/workflow-reports/snapshot-publish.jsonl'
const SNAPSHOT_REPORT_DOWNLOAD_DIR = '${{ runner.temp }}/workflow-reports/snapshot-publish-download'

const DOCS_REPORT_ARTIFACT_NAME = 'docs-deploy-workflow-report'
const DOCS_REPORT_RECORD_PATH = '${{ runner.temp }}/workflow-reports/docs-deploy.jsonl'
const DOCS_REPORT_DOWNLOAD_DIR = '${{ runner.temp }}/workflow-reports/docs-deploy-download'

const EXAMPLES_REPORT_ARTIFACT_NAME = 'examples-deploy-workflow-report'
const EXAMPLES_REPORT_RECORD_PATH = '${{ runner.temp }}/workflow-reports/examples-deploy.jsonl'
const EXAMPLES_REPORT_DOWNLOAD_DIR = '${{ runner.temp }}/workflow-reports/examples-deploy-download'

const PR_PREVIEW_REPORT_BUNDLE_PATH = '${{ runner.temp }}/workflow-reports/pr-preview-bundle.json'
const PR_PREVIEW_REPORT_COMMENT_BODY_PATH = '${{ runner.temp }}/workflow-reports/pr-preview-comment.md'
const PR_PREVIEW_REPORT_SUMMARY_PATH = '${{ runner.temp }}/workflow-reports/pr-preview-summary.md'

/**
 * Emit the snapshot publish report as a single JSONL line at runtime.
 *
 * `workflowReportProducerStep` from effect-utils validates the record at genie
 * codegen time, which forces every field to a literal value before GitHub
 * Actions has a chance to interpolate. The `createdAtUtc` ISO timestamp is the
 * one piece we genuinely need at runtime, so we build the record inline with
 * `jq` (mirroring the canonical `netlifyDeployStep` pattern in effect-utils).
 *
 * The bash payload writes the JSONL line to the agreed shared output path so
 * the dedicated `report-snapshot-publish` job can collect it from an uploaded
 * artifact and run the collector → comment-body → publisher pipeline.
 */
const emitSnapshotPublishReportStep = {
  name: 'Emit snapshot publish workflow report',
  shell: 'bash' as const,
  if: "${{ github.event_name == 'pull_request' && steps.publish-snapshot.outcome == 'success' }}",
  env: {
    WORKFLOW_REPORT_OUTPUT_PATH: SNAPSHOT_REPORT_RECORD_PATH,
    SNAPSHOT_VERSION: `0.0.0-snapshot-${PR_HEAD_SHA}`,
    HEAD_SHA: PR_HEAD_SHA,
    RUN_ID: GITHUB_RUN_ID,
    REPOSITORY: '${{ github.repository }}',
  },
  run: [
    'set -euo pipefail',
    'mkdir -p "$(dirname "$WORKFLOW_REPORT_OUTPUT_PATH")"',
    'created_at_utc="$(date -u +%Y-%m-%dT%H:%M:%SZ)"',
    'record_id="snapshot-publish-${HEAD_SHA}"',
    'npm_url="https://www.npmjs.com/package/@livestore/livestore/v/${SNAPSHOT_VERSION}"',
    'run_url="https://github.com/${REPOSITORY}/actions/runs/${RUN_ID}"',
    'install_cmd="pnpm add @livestore/livestore@${SNAPSHOT_VERSION}"',
    'record_json="$(jq -cn \\',
    '  --arg id "$record_id" \\',
    '  --arg version "$SNAPSHOT_VERSION" \\',
    '  --arg headSha "$HEAD_SHA" \\',
    '  --arg runId "$RUN_ID" \\',
    '  --arg createdAtUtc "$created_at_utc" \\',
    '  --arg npmUrl "$npm_url" \\',
    '  --arg runUrl "$run_url" \\',
    '  --arg installCmd "$install_cmd" \\',
    "  '{",
    '    _tag: "WorkflowReportRecord",',
    '    schemaVersion: 1,',
    '    id: $id,',
    '    kind: "npm-snapshot-publish",',
    '    subject: { id: "livestore-npm-snapshot", label: "LiveStore npm snapshot" },',
    '    status: "success",',
    '    title: ("Snapshot published as " + $version),',
    '    summary: ("Install with `" + $installCmd + "`"),',
    '    createdAtUtc: $createdAtUtc,',
    '    links: [',
    '      { label: "@livestore/livestore on npm", url: $npmUrl, primary: true },',
    '      { label: "Chrome devtools ZIP (workflow run artifacts)", url: $runUrl }',
    '    ],',
    '    data: { snapshotVersion: $version, headSha: $headSha, runId: $runId }',
    '  }\')"',
    'workflow_report_line="WORKFLOW_REPORT_V1: ${record_json}"',
    'printf "%s\\n" "$workflow_report_line"',
    'printf "%s\\n" "$workflow_report_line" > "$WORKFLOW_REPORT_OUTPUT_PATH"',
  ].join('\n'),
}

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
const standardCIJob = (config: { env?: Record<string, string>; if?: string; steps: unknown[] }) => ({
  ...namespaceRunnerConfig,
  if: config.if,
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
 * Required status checks are managed by `.github/repo-settings.json.genie.ts`.
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
      // Only main is an integration branch. Regular pushes deploy dev docs/examples surfaces.
      branches: ['main'],
    },
    workflow_dispatch: {},
    pull_request: {},
  },

  env: {
    GITHUB_BRANCH_NAME: '${{ github.head_ref || github.ref_name }}',
    CACHIX_AUTH_TOKEN: '${{ secrets.CACHIX_AUTH_TOKEN }}',
    FORCE_SETUP: '1',
    CI: 'true',
  },

  jobs: {
    'source-policy': livestoreDefaultRefPolicyJob,
    lint: standardCIJob({
      steps: [
        ...livestoreSetupSteps,
        { name: 'Run lint checks', run: runDevenvTasksBefore('lint:full:with-megarepo-check') },
      ],
    }),

    'changeset-check': standardCIJob({
      if: "github.event_name == 'pull_request'",
      steps: [
        ...livestoreSetupSteps,
        {
          name: 'Fetch changeset comparison base',
          run: 'git fetch origin "${{ github.base_ref }}" --depth=1',
        },
        {
          name: 'Check release intent',
          run: runDevenvTasksBefore('release:changeset:check-pr'),
          env: {
            CHANGESET_BASE_REF: 'origin/${{ github.base_ref }}',
          },
        },
        {
          name: 'Check changeset bodies',
          run: runDevenvTasksBefore('release:changeset:check-bodies'),
        },
      ],
    }),

    'ruleset-drift-check': standardCIJob({
      if: "(github.event_name == 'workflow_dispatch' && !startsWith(github.ref_name, 'automation/release-')) || github.ref == 'refs/heads/main'",
      steps: [
        ...livestoreSetupSteps,
        {
          name: 'Check repository ruleset drift',
          run: runDevenvTasksBefore('github:rulesets:check'),
          env: {
            GH_TOKEN: '${{ secrets.LIVESTORE_RULESET_ADMIN_TOKEN || github.token }}',
          },
        },
      ],
    }),

    'type-check': standardCIJob({
      // TODO(oep-1n3.9): Switch back to patched tsc once Effect diagnostics backlog is addressed.
      steps: [...livestoreSetupSteps, { name: 'Run type-check', run: runDevenvTasksBefore('ts:build') }],
    }),

    'test-unit': standardCIJob({
      steps: [...livestoreSetupSteps, { name: 'Run unit tests', run: runDevenvTasksBefore('test:unit') }],
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
     * Keep only the publish boundary on GitHub-hosted runners. The heavy tests
     * above may use Namespace/self-hosted runners, but npm trusted publishing
     * currently requires GitHub-hosted OIDC and does not support self-hosted
     * runners. Do not add an npm write token here; the npm package settings
     * should trust this workflow file (`ci.yml`) for snapshot publishes.
     */
    'publish-snapshot-version': {
      if: IS_NOT_FORK,
      'runs-on': 'ubuntu-24.04',
      permissions: {
        contents: 'write',
        'id-token': 'write',
      },
      outputs: {
        npm_snapshot_published: "${{ steps.publish-snapshot.outcome == 'success' && '1' || '0' }}",
      },
      needs: ['test-unit', 'test-integration-sync-provider', 'test-integration-playwright'],
      env: {
        GH_TOKEN: '${{ github.token }}',
      },
      defaults: bashShellDefaults,
      steps: withNixDiagnosticsOnFailure([
        ...livestoreSetupSteps,
        {
          id: 'publish-snapshot',
          name: 'Publish snapshot version',
          run: runDevenvTasksBefore('release:snapshot:git-sha'),
          env: { GIT_SHA: PR_HEAD_SHA },
        },
        {
          name: 'Publish DevTools artifact snapshot',
          run: runDevenvTasksBefore('release:devtools-artifact:publish'),
          env: {
            LIVESTORE_DEVTOOLS_OUT_DIR: '${{ runner.temp }}/livestore-devtools-snapshot',
            LIVESTORE_RELEASE_VERSION: `0.0.0-snapshot-${PR_HEAD_SHA}`,
          },
        },
        {
          name: 'Upload DevTools Chrome snapshot artifact',
          uses: 'actions/upload-artifact@v4',
          with: {
            name: `livestore-devtools-chrome-0.0.0-snapshot-${PR_HEAD_SHA}`,
            path: '${{ runner.temp }}/livestore-devtools-snapshot/livestore-devtools-chrome-0.0.0-snapshot-${{ github.event.pull_request.head.sha || github.sha }}.zip',
            'if-no-files-found': 'error',
            'retention-days': 14,
          },
        },
        emitSnapshotPublishReportStep,
        {
          name: 'Upload snapshot publish workflow report',
          if: `\${{ github.event_name == 'pull_request' && steps.publish-snapshot.outcome == 'success' }}`,
          uses: 'actions/upload-artifact@v4',
          with: {
            name: SNAPSHOT_REPORT_ARTIFACT_NAME,
            path: SNAPSHOT_REPORT_RECORD_PATH,
            'if-no-files-found': 'error',
            'retention-days': 14,
          },
        },
      ]),
    },

    /**
     * Aggregate every PR-time deploy/publish workflow report and upsert a
     * single managed PR comment. Runs after the snapshot/docs/examples jobs so
     * all producer artifacts are available; individual artifacts are allowed to
     * be missing (e.g. snapshot is skipped on forks) so the comment still
     * publishes whatever subset succeeded.
     */
    'report-pr-preview': {
      if: `\${{ github.event_name == 'pull_request' && !cancelled() }}`,
      needs: ['publish-snapshot-version', 'build-deploy-docs', 'build-and-deploy-examples-src'],
      ...namespaceRunnerConfig,
      permissions: {
        contents: 'read',
        'pull-requests': 'write',
      },
      defaults: bashShellDefaults,
      steps: [
        ...livestoreSetupSteps,
        {
          name: 'Download snapshot publish workflow report',
          if: `\${{ needs.publish-snapshot-version.outputs.npm_snapshot_published == '1' }}`,
          uses: 'actions/download-artifact@v4',
          'continue-on-error': true,
          with: {
            name: SNAPSHOT_REPORT_ARTIFACT_NAME,
            path: SNAPSHOT_REPORT_DOWNLOAD_DIR,
          },
        },
        {
          name: 'Download docs deploy workflow report',
          if: `\${{ needs.build-deploy-docs.result == 'success' }}`,
          uses: 'actions/download-artifact@v4',
          'continue-on-error': true,
          with: {
            name: DOCS_REPORT_ARTIFACT_NAME,
            path: DOCS_REPORT_DOWNLOAD_DIR,
          },
        },
        {
          name: 'Download examples deploy workflow report',
          if: `\${{ needs.build-and-deploy-examples-src.result == 'success' }}`,
          uses: 'actions/download-artifact@v4',
          'continue-on-error': true,
          with: {
            name: EXAMPLES_REPORT_ARTIFACT_NAME,
            path: EXAMPLES_REPORT_DOWNLOAD_DIR,
          },
        },
        workflowReportCollectorStep({
          bundleId: 'pr-preview',
          inputPaths: [
            `${SNAPSHOT_REPORT_DOWNLOAD_DIR}/snapshot-publish.jsonl`,
            `${DOCS_REPORT_DOWNLOAD_DIR}/docs-deploy.jsonl`,
            `${EXAMPLES_REPORT_DOWNLOAD_DIR}/examples-deploy.jsonl`,
          ],
          outputPath: PR_PREVIEW_REPORT_BUNDLE_PATH,
          allowMissingInput: true,
        }),
        workflowReportCommentBodyStep({
          bundlePath: PR_PREVIEW_REPORT_BUNDLE_PATH,
          commentBodyPath: PR_PREVIEW_REPORT_COMMENT_BODY_PATH,
          summaryPath: PR_PREVIEW_REPORT_SUMMARY_PATH,
          title: 'PR preview',
          noRecordsMessage: 'No previews or snapshot were published for this commit.',
          stateId: PR_PREVIEW_REPORT_STATE_ID,
          entryId: PR_HEAD_SHA,
          entryLabel: `PR \${{ github.event.pull_request.number }}`,
        }),
        workflowReportPublisherStep({
          commentBodyPath: PR_PREVIEW_REPORT_COMMENT_BODY_PATH,
          summaryPath: PR_PREVIEW_REPORT_SUMMARY_PATH,
          stateId: PR_PREVIEW_REPORT_STATE_ID,
        }),
      ],
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
          id: 'deploy-examples',
          name: 'Deploy examples to Cloudflare',
          if: IS_NOT_FORK,
          run: ['mkdir -p "$(dirname "$WORKFLOW_REPORT_OUTPUT_FILE")"', runDevenvTasksBefore('examples:deploy')].join(
            '\n',
          ),
          env: {
            CLOUDFLARE_API_TOKEN: '${{ secrets.CLOUDFLARE_API_TOKEN }}',
            CLOUDFLARE_ACCOUNT_ID: '${{ secrets.CLOUDFLARE_ACCOUNT_ID }}',
            WORKFLOW_REPORT_OUTPUT_FILE: EXAMPLES_REPORT_RECORD_PATH,
          },
        },
        {
          name: 'Upload examples deploy workflow report',
          if: `\${{ github.event_name == 'pull_request' && steps.deploy-examples.outcome == 'success' }}`,
          uses: 'actions/upload-artifact@v4',
          with: {
            name: EXAMPLES_REPORT_ARTIFACT_NAME,
            path: EXAMPLES_REPORT_RECORD_PATH,
            'if-no-files-found': 'warn',
            'retention-days': 14,
          },
        },
        {
          name: 'Validate hosted example links',
          run: runDevenvTasksBefore('examples:validate-links'),
        },
      ]),
    },

    /**
     * Docs deployment mapping (authoritative, with domains) — handled by `mono docs deploy`:
     * - pull_request (any base): deploy alias on dev docs site (no purge)
     *     example domain: https://<alias>--livestore-docs-dev.netlify.app
     * - push to main: deploy to dev docs site as prod
     *     domain: https://dev.docs.livestore.dev
     * - stable release publish: release.yml deploys prod docs explicitly
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
          id: 'deploy-docs',
          name: 'Deploy docs',
          if: `\${{ success() && (github.event_name != 'pull_request' || ${IS_NOT_FORK}) }}`,
          run: ['mkdir -p "$(dirname "$WORKFLOW_REPORT_OUTPUT_FILE")"', runDevenvTasksBefore('docs:deploy')].join('\n'),
          env: {
            NETLIFY_AUTH_TOKEN: '${{ secrets.NETLIFY_AUTH_TOKEN }}',
            WORKFLOW_REPORT_OUTPUT_FILE: DOCS_REPORT_RECORD_PATH,
          },
        },
        {
          name: 'Upload docs deploy workflow report',
          if: `\${{ github.event_name == 'pull_request' && steps.deploy-docs.outcome == 'success' }}`,
          uses: 'actions/upload-artifact@v4',
          with: {
            name: DOCS_REPORT_ARTIFACT_NAME,
            path: DOCS_REPORT_RECORD_PATH,
            'if-no-files-found': 'warn',
            'retention-days': 14,
          },
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
    //   if: "github.ref == 'refs/heads/main' && github.event_name == 'push'",
    //   steps: [dispatchAlignmentStep({ targetRepo: 'schickling/megarepo-all' })],
    // },
  },
})
