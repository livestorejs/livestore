import { bashShellDefaults, defaultActionlintConfig, githubWorkflow } from '../../genie/repo.ts'

const paths = [
  'context/05-contributing/02-community/meeting-schedule.json',
  'packages/@local/shared/src/contributor-meeting.ts',
  'packages/@local/shared/src/contributor-meeting-failure.ts',
  'packages/@local/shared/package.json',
  'scripts/src/meetings/**',
  'docs/src/components/ContributorMeetings.astro',
  'docs/src/content/docs/misc/contributor-sync.mdx',
  'docs/astro.config.ts',
  'docs/src/utils/verify-contributor-meeting.ts',
  '.github/workflows/contributor-meetings.yml',
  '.github/workflows/contributor-meetings.yml.genie.ts',
  'scripts/bootstrap-minimal.sh',
  'package.json',
  'pnpm-lock.yaml',
  'devenv.lock',
]

const setup = [
  { uses: 'actions/checkout@v6', with: { 'persist-credentials': false } },
  { uses: 'actions/setup-node@v6', with: { 'node-version': '24' } },
  { uses: 'oven-sh/setup-bun@v2', with: { 'bun-version': '1.3.13' } },
  { uses: 'pnpm/action-setup@v4', with: { run_install: false } },
  { name: 'Install locked workspace dependencies', 'timeout-minutes': 2, run: './scripts/bootstrap-minimal.sh' },
]

export default githubWorkflow({
  name: 'Contributor meetings',
  actionlint: defaultActionlintConfig,
  on: {
    pull_request: { paths },
    push: { branches: ['main'], paths },
    schedule: [{ cron: '23 7 * * *' }],
    workflow_dispatch: {},
  },
  permissions: { contents: 'read' },
  concurrency: {
    group: 'contributor-meetings-${{ github.event.pull_request.number || github.ref }}',
    'cancel-in-progress': false,
  },
  env: { CI: 'true' },
  jobs: {
    validate: {
      outputs: { failure: '${{ steps.validate.outputs.failure }}' },
      'runs-on': 'ubuntu-24.04',
      'timeout-minutes': 10,
      defaults: bashShellDefaults,
      steps: [
        ...setup,
        {
          name: 'Validate schedule and publisher',
          id: 'validate',
          run: 'node scripts/src/meetings/publish.ts --validate\nnode_modules/.bin/vitest run --config scripts/vitest.config.ts src/meetings',
        },
      ],
    },
    publish: {
      outputs: { failure: '${{ steps.calendar.outputs.failure || steps.site.outputs.failure }}' },
      needs: ['validate'],
      if: "github.ref == 'refs/heads/main' && vars.CONTRIBUTOR_MEETING_PUBLISHING_ENABLED == 'true'",
      'runs-on': 'ubuntu-24.04',
      // Explicit phase limits total 25 minutes; reserve five for action setup and teardown.
      'timeout-minutes': 30,
      defaults: bashShellDefaults,
      steps: [
        ...setup,
        { uses: 'DeterminateSystems/determinate-nix-action@v3', 'timeout-minutes': 2 },
        {
          name: 'Resolve locked browser runtime',
          'timeout-minutes': 4,
          run: 'bash scripts/src/meetings/resolve-playwright.sh',
        },
        {
          name: 'Verify canonical production page',
          id: 'site',
          'timeout-minutes': 8,
          run: 'PLAYWRIGHT_BIN="$(command -v node)" "$MEETING_PLAYWRIGHT_WRAPPER" docs/src/utils/verify-contributor-meeting.ts',
        },
        {
          name: 'Reconcile and verify Google Calendar',
          id: 'calendar',
          'timeout-minutes': 9,
          run: 'node scripts/src/meetings/publish.ts --apply',
          env: { MEETING_GOOGLE_SERVICE_ACCOUNT_JSON: '${{ secrets.MEETING_GOOGLE_SERVICE_ACCOUNT_JSON }}' },
        },
      ],
    },
    report: {
      needs: ['validate', 'publish'],
      if: "always() && github.ref == 'refs/heads/main' && github.event_name != 'pull_request' && vars.CONTRIBUTOR_MEETING_PUBLISHING_ENABLED == 'true'",
      permissions: { contents: 'read', actions: 'read', issues: 'write' },
      'runs-on': 'ubuntu-24.04',
      'timeout-minutes': 5,
      defaults: bashShellDefaults,
      steps: [
        { uses: 'actions/checkout@v6', with: { 'persist-credentials': false } },
        { uses: 'actions/setup-node@v6', with: { 'node-version': '24' } },
        {
          name: 'Report publication status',
          run: 'node scripts/src/meetings/report-status.ts',
          env: {
            GH_TOKEN: '${{ github.token }}',
            CONTRIBUTOR_MEETING_PUBLISHING_ENABLED: '${{ vars.CONTRIBUTOR_MEETING_PUBLISHING_ENABLED }}',
            MEETING_VALIDATION_RESULT: '${{ needs.validate.result }}',
            MEETING_PUBLICATION_RESULT: '${{ needs.publish.result }}',
            MEETING_FAILURE_CODE:
              "${{ needs.validate.result != 'success' && needs.validate.outputs.failure || needs.publish.outputs.failure }}",
          },
        },
      ],
    },
  },
})
