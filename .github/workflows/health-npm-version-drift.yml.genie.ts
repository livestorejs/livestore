import { defaultActionlintConfig, githubWorkflow } from '../../genie/repo.ts'

/**
 * Daily health check: compare npm `latest` for `@livestore/livestore` to the
 * version recorded in `release/version.json` on `main`. Drift inside a 48h
 * grace window is just a `::notice::`; sustained drift opens (or warms) a
 * `type:bug area:release` issue.
 *
 * Intentionally minimal: no devenv / nix setup. Bun is already on the
 * GitHub-hosted runner image and the script only needs `npm view`, `gh`, and
 * `git log`.
 */
export default githubWorkflow({
  name: 'Health: npm version drift',
  actionlint: defaultActionlintConfig,

  on: {
    schedule: [{ cron: '0 8 * * *' }],
    workflow_dispatch: {},
  },

  // Issue management requires write; everything else is read-only.
  permissions: {
    contents: 'read',
    issues: 'write',
  },

  jobs: {
    check: {
      'runs-on': 'ubuntu-latest',
      'timeout-minutes': 5,
      steps: [
        { name: 'Checkout', uses: 'actions/checkout@v4', with: { ref: 'main' } },
        { name: 'Setup Bun', uses: 'oven-sh/setup-bun@v2', with: { 'bun-version': 'latest' } },
        {
          name: 'Compare npm latest vs release/version.json',
          env: {
            GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
          },
          run: 'bun scripts/src/commands/health/npm-version-drift.ts',
        },
      ],
    },
  },
})
