/**
 * Reconciles the `main` branch ruleset from its committed desired-state file
 * using only code-owned inline steps and an environment-scoped GitHub App key.
 * See `context/03-delivery/02-release/spec.md` for the reconciliation contract.
 */
import { bashShellDefaults, defaultActionlintConfig, githubWorkflow } from '../../genie/repo.ts'

// App ID of the org-owned `livestore-ruleset-reconciler` GitHub App.
const RECONCILE_APP_ID = '4312996'

// One-off bridge until the Alchemy GitHub stack owns this setting.
const FORK_PR_APPROVAL_POLICY = 'all_external_contributors'

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
    schedule: [{ cron: '17 6 * * *' }],
    workflow_dispatch: {},
  },

  permissions: {
    contents: 'read',
  },

  jobs: {
    reconcile: {
      // Also block workflow_dispatch from an unmerged branch.
      if: "github.ref == 'refs/heads/main'",
      environment: 'github-admin',
      'runs-on': 'ubuntu-latest',
      defaults: bashShellDefaults,
      steps: [
        {
          uses: 'actions/checkout@v6',
          with: { 'persist-credentials': false },
        },
        {
          id: 'app-token',
          name: 'Mint App token',
          uses: 'actions/create-github-app-token@v2',
          with: {
            'app-id': RECONCILE_APP_ID,
            'private-key': '${{ secrets.LIVESTORE_RULESET_APP_KEY }}',
            'permission-administration': 'write',
          },
        },
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
          env: { GH_TOKEN: '${{ steps.app-token.outputs.token }}' },
          run: `set -euo pipefail
ruleset_id="$(gh api --paginate "repos/$GITHUB_REPOSITORY/rulesets" --jq '.[] | select(.name == "main-branch-rules") | .id')"
if [[ -n "$ruleset_id" ]]; then
  gh api --method PUT "repos/$GITHUB_REPOSITORY/rulesets/$ruleset_id" --input .github/repo-settings.json
else
  gh api --method POST "repos/$GITHUB_REPOSITORY/rulesets" --input .github/repo-settings.json
fi`,
        },
        {
          name: 'Verify ruleset',
          env: { GH_TOKEN: '${{ steps.app-token.outputs.token }}' },
          run: `set -euo pipefail
ruleset_file=".github/repo-settings.json"
ruleset_id="$(gh api --paginate "repos/$GITHUB_REPOSITORY/rulesets" --jq '.[] | select(.name == "main-branch-rules") | .id')"
if [[ -z "$ruleset_id" ]]; then
  echo "No live ruleset found with name 'main-branch-rules'" >&2
  exit 1
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
# The App token has administration:write, so always compare bypass_actors.
jq_normalize='
  {
    name,
    target,
    enforcement,
    bypass_actors: (.bypass_actors // []),
    conditions,
    rules: [
      .rules[]
      | if .type == "pull_request" then
          .parameters |= (
            del(.allowed_merge_methods, .required_reviewers)
            | if .dismissal_restriction == { allowed_actors: [], enabled: false } then
                del(.dismissal_restriction)
              else
                .
              end
          )
        else
          .
        end
    ]
  }
'
jq -S "$jq_normalize" "$ruleset_file" > "$tmp_dir/desired.json"
gh api "repos/$GITHUB_REPOSITORY/rulesets/$ruleset_id" | jq -S "$jq_normalize" > "$tmp_dir/live.json"
if ! diff -u "$tmp_dir/desired.json" "$tmp_dir/live.json"; then
  echo "Ruleset 'main-branch-rules' drift detected against $ruleset_file." >&2
  exit 1
fi
echo "Ruleset 'main-branch-rules' is in sync with $ruleset_file."`,
        },
      ],
    },
  },
})
