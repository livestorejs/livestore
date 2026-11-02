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

// One-off bridge until the Alchemy GitHub stack owns this setting.
const FORK_PR_APPROVAL_POLICY = 'all_external_contributors'

/**
 * Mints a GitHub App installation token scoped to least privilege. Without an
 * explicit `permission-*` input the token inherits all of the App's permissions
 * (`administration:write`); the PR `plan` job runs PR-controlled code, so it gets
 * a read-only token, while `reconcile` (which PUTs the ruleset) gets write.
 */
const appTokenStep = (administration: 'read' | 'write') => ({
  id: 'app-token',
  name: 'Mint App token',
  uses: 'actions/create-github-app-token@v2',
  with: {
    'app-id': RECONCILE_APP_ID,
    'private-key': '${{ secrets.LIVESTORE_RULESET_APP_KEY }}',
    'permission-administration': administration,
  },
})

export default githubWorkflow({
  name: 'Repo settings',
  actionlint: defaultActionlintConfig,

  on: {
    push: {
      branches: ['main'],
      paths: [
        '.github/repo-settings.json',
        '.github/workflows/repo-settings.yml',
        '.github/workflows/repo-settings.yml.genie.ts',
      ],
    },
    pull_request: {
      paths: [
        '.github/repo-settings.json',
        '.github/repo-settings.json.genie.ts',
        '.github/workflows/repo-settings.yml',
        '.github/workflows/repo-settings.yml.genie.ts',
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
    CI: 'true',
    FORCE_SETUP: '1',
  },

  jobs: {
    reconcile: {
      // Only reconcile from `main`. push(main) and schedule already run on main;
      // this also blocks a `workflow_dispatch` from an unmerged branch (whose
      // checkout would otherwise apply that branch's repo-settings.json to the
      // live main ruleset). PRs (ref `refs/pull/N/merge`) are excluded too.
      if: "github.ref == 'refs/heads/main'",
      'runs-on': 'ubuntu-latest',
      defaults: bashShellDefaults,
      steps: [
        ...livestoreSetupSteps,
        appTokenStep('write'),
        {
          name: 'Reconcile fork PR contributor approval',
          env: {
            GH_TOKEN: '${{ steps.app-token.outputs.token }}',
            GH_REPO: '${{ github.repository }}',
            FORK_PR_APPROVAL_POLICY,
          },
          run: [
            'endpoint="repos/$GH_REPO/actions/permissions/fork-pr-contributor-approval"',
            'before=$(gh api --method GET "$endpoint" --jq .approval_policy)',
            'printf "Fork PR approval before: %s\\n" "$before"',
            'if [[ "$before" != "$FORK_PR_APPROVAL_POLICY" ]]; then',
            '  gh api --method PUT "$endpoint" -f approval_policy="$FORK_PR_APPROVAL_POLICY"',
            'fi',
            'after=$(gh api --method GET "$endpoint" --jq .approval_policy)',
            'printf "Fork PR approval after: %s\\n" "$after"',
            '[[ "$after" == "$FORK_PR_APPROVAL_POLICY" ]]',
          ].join('\n'),
        },
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
        appTokenStep('read'),
        {
          name: 'Plan fork PR contributor approval',
          env: {
            GH_TOKEN: '${{ steps.app-token.outputs.token }}',
            GH_REPO: '${{ github.repository }}',
            FORK_PR_APPROVAL_POLICY,
          },
          run: [
            'current=$(gh api --method GET "repos/$GH_REPO/actions/permissions/fork-pr-contributor-approval" --jq .approval_policy)',
            'printf "Fork PR approval current: %s\\nFork PR approval intended: %s\\n" "$current" "$FORK_PR_APPROVAL_POLICY"',
          ].join('\n'),
        },
        {
          name: 'Plan ruleset',
          run: runDevenvTasksBefore('github:rulesets:plan'),
          env: { GH_TOKEN: '${{ steps.app-token.outputs.token }}' },
        },
      ],
    },
  },
})
