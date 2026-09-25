import {
  bashShellDefaults,
  defaultActionlintConfig,
  githubWorkflow,
  livestoreSetupSteps,
  runDevenvTasksBefore,
} from '../../genie/repo.ts'

const paths = [
  'context/05-contributing/02-community/meeting-schedule.json',
  'packages/@local/shared/src/contributor-meeting.ts',
  'scripts/src/meetings/**',
  'docs/src/components/ContributorMeetings.astro',
  'docs/src/utils/verify-contributor-meeting.ts',
  '.github/workflows/contributor-meetings.yml',
  '.github/workflows/contributor-meetings.yml.genie.ts',
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
  env: { CACHIX_AUTH_TOKEN: '${{ secrets.CACHIX_AUTH_TOKEN }}', CI: 'true', FORCE_SETUP: '1' },
  jobs: {
    validate: {
      'runs-on': 'ubuntu-24.04',
      'timeout-minutes': 30,
      defaults: bashShellDefaults,
      steps: [
        ...livestoreSetupSteps,
        { name: 'Validate schedule and publisher', run: runDevenvTasksBefore('meetings:check') },
      ],
    },
    publish: {
      needs: ['validate'],
      if: "github.ref == 'refs/heads/main' && vars.CONTRIBUTOR_MEETING_PUBLISHING_ENABLED == 'true'",
      'runs-on': 'ubuntu-24.04',
      'timeout-minutes': 30,
      defaults: bashShellDefaults,
      steps: [
        ...livestoreSetupSteps,
        { name: 'Verify canonical production page', run: runDevenvTasksBefore('meetings:verify-site') },
        {
          name: 'Reconcile and verify Google Calendar',
          run: runDevenvTasksBefore('meetings:publish'),
          env: { MEETING_GOOGLE_SERVICE_ACCOUNT_JSON: '${{ secrets.MEETING_GOOGLE_SERVICE_ACCOUNT_JSON }}' },
        },
      ],
    },
  },
})
