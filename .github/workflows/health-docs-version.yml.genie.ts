import { defaultActionlintConfig, githubWorkflow } from '../../genie/repo.ts'

/**
 * Health check: confirm https://docs.livestore.dev serves the same version
 * that npm `latest` points at. Reads the `<meta name="livestore-version">`
 * tag emitted by `docs/astro.config.ts`.
 *
 * Triggers:
 * - daily cron (09:15 Europe/Berlin),
 * - GitHub Release `published` (with a 30m grace window for the docs deploy
 *   to catch up),
 * - manual `workflow_dispatch`.
 *
 * No devenv / nix setup needed — `bun`, `curl`, `npm view`, and `gh` are all
 * present on the GitHub-hosted runner image.
 *
 * Note: this check does not automatically re-trigger a docs deploy because
 * the docs pipeline runs through Netlify (not a first-party workflow); see
 * the PR description for context on the deferred auto-recovery hook.
 */
export default githubWorkflow({
  name: 'Health: docs version',
  actionlint: defaultActionlintConfig,

  on: {
    schedule: [{ cron: '15 8 * * *' }],
    release: { types: ['published'] },
    workflow_dispatch: {},
  },

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
          name: 'Compare docs version vs npm latest',
          env: {
            GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
          },
          run: [
            'bun scripts/src/commands/health/docs-version.ts',
            '  --trigger="${{ github.event_name }}"',
            '  --release-published-at="${{ github.event.release.published_at }}"',
            '  --release-grace-min=30',
          ].join(' \\\n'),
        },
      ],
    },
  },
})
