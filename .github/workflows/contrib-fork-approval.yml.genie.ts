/**
 * Temporary one-off for livestore-contrib until GitHub IaC P4 enrolls contrib.
 * Requires App 4312996 installed on livestore-contrib.
 */
import { bashShellDefaults, defaultActionlintConfig, githubWorkflow } from '../../genie/repo.ts'

const RECONCILE_APP_ID = '4312996'
const FORK_PR_APPROVAL_POLICY = 'all_external_contributors'

export default githubWorkflow({
  name: 'Contrib fork approval',
  actionlint: defaultActionlintConfig,
  on: { workflow_dispatch: {} },
  permissions: {},
  jobs: {
    reconcile: {
      if: "github.ref == 'refs/heads/main'",
      'runs-on': 'ubuntu-latest',
      defaults: bashShellDefaults,
      steps: [
        {
          id: 'app-token',
          name: 'Mint App token',
          uses: 'actions/create-github-app-token@v2',
          with: {
            'app-id': RECONCILE_APP_ID,
            'private-key': '${{ secrets.LIVESTORE_RULESET_APP_KEY }}',
            owner: 'livestorejs',
            repositories: 'livestore-contrib',
            'permission-administration': 'write',
          },
        },
        {
          name: 'Reconcile contrib fork PR contributor approval',
          env: {
            GH_TOKEN: '${{ steps.app-token.outputs.token }}',
            FORK_PR_APPROVAL_POLICY,
          },
          run: [
            'set -euo pipefail',
            'endpoint="repos/livestorejs/livestore-contrib/actions/permissions/fork-pr-contributor-approval"',
            'before=$(gh api --method GET "$endpoint" --jq .approval_policy)',
            'printf "Fork PR approval before: %s\\n" "$before" >> "$GITHUB_STEP_SUMMARY"',
            'if [[ "$before" != "$FORK_PR_APPROVAL_POLICY" ]]; then',
            '  gh api --method PUT "$endpoint" -f approval_policy="$FORK_PR_APPROVAL_POLICY"',
            'fi',
            'after=$(gh api --method GET "$endpoint" --jq .approval_policy)',
            'printf "Fork PR approval after: %s\\n" "$after" >> "$GITHUB_STEP_SUMMARY"',
            '[[ "$after" == "$FORK_PR_APPROVAL_POLICY" ]]',
          ].join('\n'),
        },
      ],
    },
  },
})
