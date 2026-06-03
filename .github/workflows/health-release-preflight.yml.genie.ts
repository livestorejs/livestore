import { defaultActionlintConfig, githubWorkflow } from '../../genie/repo.ts'

/**
 * Release-pipeline pre-flight: exercises every external token, OIDC binding,
 * and DNS path the real publish job depends on — without ever publishing.
 *
 * Triggers:
 * - weekly cron (Mon 08:00 Europe/Berlin),
 * - any PR touching `.github/workflows/release.yml*` (catches secrets/PATH
 *   regressions before they ship),
 * - manual `workflow_dispatch`.
 *
 * The job uses an OIDC `id-token: write` permission so future iterations can
 * validate the trusted-publisher subject claim without storing additional
 * long-lived credentials.
 */
export default githubWorkflow({
  name: 'Health: release pre-flight',
  actionlint: defaultActionlintConfig,

  on: {
    schedule: [{ cron: '0 7 * * 1' }],
    pull_request: {
      paths: [
        '.github/workflows/release.yml',
        '.github/workflows/release.yml.genie.ts',
        '.github/workflows/health-release-preflight.yml',
        '.github/workflows/health-release-preflight.yml.genie.ts',
        'scripts/src/commands/health/release-preflight.ts',
      ],
    },
    workflow_dispatch: {},
  },

  permissions: {
    contents: 'read',
    issues: 'write',
    'id-token': 'write',
  },

  jobs: {
    preflight: {
      'runs-on': 'ubuntu-latest',
      'timeout-minutes': 10,
      steps: [
        { name: 'Checkout', uses: 'actions/checkout@v4', with: { ref: 'main' } },
        { name: 'Setup Bun', uses: 'oven-sh/setup-bun@v2', with: { 'bun-version': 'latest' } },
        // Match the runtime profile the real publish job sees: pnpm + node + jq + gh
        // are all on the GitHub-hosted image already, but we explicitly check for
        // them in the script so missing-tool regressions show up.
        {
          name: 'Setup pnpm',
          uses: 'pnpm/action-setup@v4',
          with: { version: 11 },
        },
        {
          name: 'Setup Node.js',
          uses: 'actions/setup-node@v4',
          with: { 'node-version': '22' },
        },
        {
          name: 'Run pre-flight checks',
          env: {
            GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
            CLOUDFLARE_API_TOKEN: '${{ secrets.CLOUDFLARE_API_TOKEN }}',
            CLOUDFLARE_ACCOUNT_ID: '${{ secrets.CLOUDFLARE_ACCOUNT_ID }}',
            NETLIFY_AUTH_TOKEN: '${{ secrets.NETLIFY_AUTH_TOKEN }}',
            MXBAI_API_KEY: '${{ secrets.MXBAI_API_KEY }}',
            MXBAI_VECTOR_STORE_ID: '${{ secrets.MXBAI_VECTOR_STORE_ID }}',
          },
          run: 'bun scripts/src/commands/health/release-preflight.ts --state-file=preflight-state.json',
        },
        {
          name: 'Upload pre-flight state',
          if: 'always()',
          uses: 'actions/upload-artifact@v4',
          with: {
            name: 'release-preflight-state',
            path: 'preflight-state.json',
            'if-no-files-found': 'ignore',
            'retention-days': 30,
          },
        },
      ],
    },
  },
})
