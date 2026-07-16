/**
 * Reconciles the `main` branch ruleset from its committed desired-state file
 * (`.github/repo-settings.json`) using an org-owned GitHub App as the privileged
 * identity. Apply-on-merge (path-filtered) + a scheduled backstop converge the
 * live ruleset; pull requests get a non-gating dry-run plan.
 *
 * See `context/repo-ruleset-sync/` for the design, decisions, and the manual
 * (non-IaC) App provisioning steps.
 */
import {
  bashShellDefaults,
  defaultActionlintConfig,
  githubWorkflow,
  livestoreSetupSteps,
  runDevenvTasksBefore,
} from '../../genie/repo.ts'

// App ID of the org-owned `livestore-ruleset-reconciler` GitHub App (see context/repo-ruleset-sync).
const RECONCILE_APP_ID = '4312996'

const appTokenStep = {
  id: 'app-token',
  name: 'Mint App token',
  uses: 'actions/create-github-app-token@v2',
  with: {
    'app-id': RECONCILE_APP_ID,
    'private-key': '${{ secrets.LIVESTORE_RULESET_APP_KEY }}',
  },
}

export default githubWorkflow({
  name: 'Repo settings',
  actionlint: defaultActionlintConfig,

  on: {
    push: {
      branches: ['main'],
      paths: ['.github/repo-settings.json'],
    },
    pull_request: {
      paths: [
        '.github/repo-settings.json',
        '.github/repo-settings.json.genie.ts',
        'genie/ci.ts',
        '.github/reconcile-app-manifest.json',
      ],
    },
    schedule: [{ cron: '17 6 * * *' }],
    workflow_dispatch: {},
  },

  permissions: {
    contents: 'read',
  },

  env: {
    CACHIX_AUTH_TOKEN: '${{ secrets.CACHIX_AUTH_TOKEN }}',
    CI: 'true',
    FORCE_SETUP: '1',
  },

  jobs: {
    reconcile: {
      if: "github.event_name != 'pull_request'",
      'runs-on': 'ubuntu-latest',
      defaults: bashShellDefaults,
      steps: [
        ...livestoreSetupSteps,
        appTokenStep,
        {
          name: 'Apply ruleset',
          run: runDevenvTasksBefore('github:rulesets:sync'),
          env: { GH_TOKEN: '${{ steps.app-token.outputs.token }}' },
        },
        {
          name: 'Verify ruleset',
          run: runDevenvTasksBefore('github:rulesets:check'),
          env: { GH_TOKEN: '${{ steps.app-token.outputs.token }}' },
        },
        {
          name: 'Check App definition drift',
          run: runDevenvTasksBefore('github:app:check'),
          env: {
            RECONCILE_APP_ID: RECONCILE_APP_ID,
            RECONCILE_APP_PRIVATE_KEY: '${{ secrets.LIVESTORE_RULESET_APP_KEY }}',
          },
        },
      ],
    },

    plan: {
      if: "github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository",
      'runs-on': 'ubuntu-latest',
      defaults: bashShellDefaults,
      steps: [
        ...livestoreSetupSteps,
        appTokenStep,
        {
          name: 'Plan ruleset',
          run: runDevenvTasksBefore('github:rulesets:plan'),
          env: { GH_TOKEN: '${{ steps.app-token.outputs.token }}' },
        },
      ],
    },
  },
})
