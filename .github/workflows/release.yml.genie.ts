import {
  bashShellDefaults,
  defaultActionlintConfig,
  githubWorkflow,
  livestoreDefaultRefPolicyJob,
  livestoreSetupSteps,
  otelSetupStep,
  runDevenvTasksBefore,
  savePnpmStateStep,
  nixDiagnosticsArtifactStep,
} from '../../genie/repo.ts'

const withNixDiagnosticsOnFailure = (steps: unknown[]) => [
  ...steps,
  savePnpmStateStep({ keyPrefix: 'livestore-pnpm-state-v1' }),
  nixDiagnosticsArtifactStep(),
]

const devtoolsCertificationArtifactsStep = {
  uses: 'actions/upload-artifact@v4',
  if: '${{ !cancelled() }}',
  with: {
    name: 'devtools-certification-playwright-artifacts-${{ github.job }}',
    path: `tests/integration/playwright-report/
tests/integration/test-results/devtools/`,
    'retention-days': 30,
    'if-no-files-found': 'ignore',
  },
}

const releasePlanPaths = [
  '.github/workflows/release.yml',
  '.github/workflows/release.yml.genie.ts',
  '.github/workflows/deploy-prod.yml',
  '.github/workflows/deploy-prod.yml.genie.ts',
  'genie/repo.ts',
  'nix/devenv-modules/tasks/local/mono-wrappers.nix',
  'release/release-plan.json',
  'release/release-notes.md',
  'release/version.json',
  'release/devtools-artifact.json',
  'scripts/src/commands/release.ts',
  'scripts/src/commands/devtools-artifact.ts',
  'scripts/src/commands/changesets.ts',
  'scripts/src/commands/docs.ts',
  'scripts/src/shared/netlify.ts',
]

const RELEASE_HEAD_SHA = '${{ github.event.workflow_run.head_sha || github.sha }}'

export default githubWorkflow({
  name: 'Release',
  actionlint: defaultActionlintConfig,

  on: {
    workflow_dispatch: {
      inputs: {
        npm_tag: {
          description: 'npm dist-tag for the release',
          required: true,
          default: 'latest',
          type: 'string',
        },
        mode: {
          description: 'Release workflow mode',
          required: true,
          default: 'create-release-pr',
          type: 'choice',
          options: ['create-release-pr', 'validate-release-plan', 'publish-release', 'publish-snapshot'],
        },
      },
    },
    workflow_run: {
      workflows: ['ci'],
      types: ['completed'],
    },
    pull_request_review: {
      types: ['submitted'],
    },
    pull_request: {
      paths: releasePlanPaths,
    },
    push: {
      branches: ['main'],
      paths: ['release/release-plan.json'],
    },
  },

  permissions: {
    contents: 'read',
    'id-token': 'write',
  },

  env: {
    CACHIX_AUTH_TOKEN: '${{ secrets.CACHIX_AUTH_TOKEN }}',
    CI: 'true',
    FORCE_SETUP: '1',
  },

  jobs: {
    'source-policy': {
      ...livestoreDefaultRefPolicyJob,
      if: "github.event_name != 'pull_request_review'",
    },
    'validate-pr-snapshot': {
      if: "(github.event_name == 'workflow_run' && github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'pull_request' && github.event.workflow_run.head_repository.full_name == github.repository) || (github.event_name == 'pull_request_review' && github.event.review.state == 'approved' && github.event.pull_request.head.repo.full_name == github.repository)",
      'runs-on': 'ubuntu-24.04',
      permissions: {
        actions: 'read',
        attestations: 'write',
        'artifact-metadata': 'write',
        contents: 'read',
        'id-token': 'write',
      },
      outputs: {
        'head-sha': '${{ steps.identity.outputs.head-sha }}',
        'manifest-digest': '${{ steps.validate.outputs.manifest-digest }}',
        'npm-tag': '${{ steps.validate.outputs.npm-tag }}',
        'package-count': '${{ steps.validate.outputs.package-count }}',
        'pr-number': '${{ steps.identity.outputs.pr-number }}',
        'run-attempt': '${{ steps.identity.outputs.run-attempt }}',
        'run-id': '${{ steps.identity.outputs.run-id }}',
        'source-run-url': '${{ steps.identity.outputs.source-run-url }}',
        'topology-digest': '${{ steps.validate.outputs.topology-digest }}',
        version: '${{ steps.validate.outputs.version }}',
      },
      env: {
        ARTIFACT_DIR: '${{ github.workspace }}/tmp/pr-snapshot-artifact',
        CACHIX_AUTH_TOKEN: '',
        GH_TOKEN: '${{ github.token }}',
        PUBLISH_LIST: '${{ github.workspace }}/tmp/pr-snapshot-publish-list.tsv',
      },
      defaults: bashShellDefaults,
      steps: [
        {
          id: 'identity',
          name: 'Resolve exact successful CI run and current PR head',
          run: `set -euo pipefail
if [ "$GITHUB_EVENT_NAME" = workflow_run ]; then
  run_id='\${{ github.event.workflow_run.id }}'
  run_attempt='\${{ github.event.workflow_run.run_attempt }}'
  head_sha='\${{ github.event.workflow_run.head_sha }}'
  source_run_url='\${{ github.event.workflow_run.html_url }}'
  prs_json=$(gh api "/repos/$GITHUB_REPOSITORY/actions/runs/$run_id/pulls")
  test "$(jq 'length' <<<"$prs_json")" = 1
  pr_number=$(jq -r '.[0].number' <<<"$prs_json")
else
  pr_number='\${{ github.event.pull_request.number }}'
  head_sha='\${{ github.event.pull_request.head.sha }}'
  runs_json=$(gh api "/repos/$GITHUB_REPOSITORY/actions/workflows/ci.yml/runs?event=pull_request&status=success&head_sha=$head_sha&per_page=100")
  run_json=$(jq -c --arg sha "$head_sha" '[.workflow_runs[] | select(.head_sha == $sha and .event == "pull_request" and .conclusion == "success")] | sort_by(.created_at) | reverse | .[0]' <<<"$runs_json")
  test "$run_json" != null
  run_id=$(jq -r '.id' <<<"$run_json")
  run_attempt=$(jq -r '.run_attempt' <<<"$run_json")
  source_run_url=$(jq -r '.html_url' <<<"$run_json")
fi

[[ "$pr_number" =~ ^[1-9][0-9]*$ ]]
[[ "$head_sha" =~ ^[0-9a-f]{40}$ ]]
[[ "$run_id" =~ ^[1-9][0-9]*$ ]]
[[ "$run_attempt" =~ ^[1-9][0-9]*$ ]]
pr_json=$(gh api "/repos/$GITHUB_REPOSITORY/pulls/$pr_number")

test "$(jq -r '.state' <<<"$pr_json")" = open
test "$(jq -r '.base.ref' <<<"$pr_json")" = main
test "$(jq -r '.head.repo.full_name' <<<"$pr_json")" = "$GITHUB_REPOSITORY"
test "$(jq -r '.head.sha' <<<"$pr_json")" = "$head_sha"

echo "head-sha=$head_sha" >> "$GITHUB_OUTPUT"
echo "pr-number=$pr_number" >> "$GITHUB_OUTPUT"
echo "run-id=$run_id" >> "$GITHUB_OUTPUT"
echo "run-attempt=$run_attempt" >> "$GITHUB_OUTPUT"
echo "source-run-url=$source_run_url" >> "$GITHUB_OUTPUT"`,
        },
        {
          name: 'Checkout trusted validator only',
          uses: 'actions/checkout@v4',
          with: {
            ref: '${{ github.sha }}',
            'persist-credentials': false,
            'sparse-checkout': `.github/scripts/pr-snapshot-artifact.mjs
scripts/src/generated/release-topology.json`,
          },
        },
        {
          name: 'Use pinned Node validator runtime',
          uses: 'actions/setup-node@v4',
          with: {
            'node-version': '24.15.0',
          },
        },
        {
          name: 'Download exact-run snapshot candidate',
          uses: 'actions/download-artifact@v4',
          with: {
            name: 'pr-snapshot-${{ steps.identity.outputs.head-sha }}',
            path: '${{ github.workspace }}/tmp/pr-snapshot-artifact',
            'github-token': '${{ github.token }}',
            'run-id': '${{ steps.identity.outputs.run-id }}',
          },
        },
        {
          id: 'validate',
          name: 'Validate immutable snapshot candidate',
          env: {
            EXPECTED_HEAD_SHA: '${{ steps.identity.outputs.head-sha }}',
            EXPECTED_PR_NUMBER: '${{ steps.identity.outputs.pr-number }}',
            EXPECTED_RUN_ID: '${{ steps.identity.outputs.run-id }}',
            EXPECTED_RUN_ATTEMPT: '${{ steps.identity.outputs.run-attempt }}',
          },
          run: `set -euo pipefail
result=$(node .github/scripts/pr-snapshot-artifact.mjs validate \\
  --artifact-dir="$ARTIFACT_DIR" \\
  --topology=scripts/src/generated/release-topology.json \\
  --repository="$GITHUB_REPOSITORY" \\
  --pr-number="$EXPECTED_PR_NUMBER" \\
  --head-sha="$EXPECTED_HEAD_SHA" \\
  --run-id="$EXPECTED_RUN_ID" \\
  --run-attempt="$EXPECTED_RUN_ATTEMPT" \\
  --publish-list="$PUBLISH_LIST")
echo "version=$(jq -r '.version' <<<"$result")" >> "$GITHUB_OUTPUT"
echo "manifest-digest=$(jq -r '.manifestDigest' <<<"$result")" >> "$GITHUB_OUTPUT"
echo "topology-digest=$(jq -r '.topologyDigest' <<<"$result")" >> "$GITHUB_OUTPUT"
echo "npm-tag=$(jq -r '.npmTag' <<<"$result")" >> "$GITHUB_OUTPUT"
echo "package-count=$(jq -r '.packageCount' <<<"$result")" >> "$GITHUB_OUTPUT"
cp "$PUBLISH_LIST" "$ARTIFACT_DIR/trusted-publish-list.tsv"`,
        },
        {
          name: 'Write trusted snapshot attestation predicate',
          env: {
            HEAD_SHA: '${{ steps.identity.outputs.head-sha }}',
            MANIFEST_DIGEST: '${{ steps.validate.outputs.manifest-digest }}',
            PR_NUMBER: '${{ steps.identity.outputs.pr-number }}',
            SOURCE_RUN_ATTEMPT: '${{ steps.identity.outputs.run-attempt }}',
            SOURCE_RUN_ID: '${{ steps.identity.outputs.run-id }}',
            TOPOLOGY_DIGEST: '${{ steps.validate.outputs.topology-digest }}',
          },
          run: `jq -n \
  --arg repository "$GITHUB_REPOSITORY" \
  --argjson prNumber "$PR_NUMBER" \
  --arg headSha "$HEAD_SHA" \
  --argjson sourceRunId "$SOURCE_RUN_ID" \
  --argjson sourceRunAttempt "$SOURCE_RUN_ATTEMPT" \
  --arg manifestSha256 "$MANIFEST_DIGEST" \
  --arg topologySha256 "$TOPOLOGY_DIGEST" \
  '{repository, prNumber, headSha, sourceRunId, sourceRunAttempt, manifestSha256, topologySha256}' \
  > "$RUNNER_TEMP/pr-snapshot-attestation.json"`,
        },
        {
          name: 'Attest validated snapshot candidate',
          uses: 'actions/attest@v4',
          with: {
            'subject-path': ['${{ env.ARTIFACT_DIR }}/*.tgz', '${{ env.ARTIFACT_DIR }}/manifest.json'].join('\n'),
            'predicate-type': 'https://livestore.dev/attestations/pr-snapshot-candidate/v1',
            'predicate-path': '${{ runner.temp }}/pr-snapshot-attestation.json',
          },
        },
        {
          name: 'Upload validated promotion artifact',
          uses: 'actions/upload-artifact@v4',
          with: {
            name: 'validated-pr-snapshot-${{ steps.identity.outputs.head-sha }}-${{ steps.identity.outputs.run-id }}',
            path: '${{ github.workspace }}/tmp/pr-snapshot-artifact/',
            'if-no-files-found': 'error',
            'retention-days': 1,
          },
        },
      ],
    },
    'authorize-pr-snapshot': {
      needs: ['validate-pr-snapshot'],
      'runs-on': 'ubuntu-24.04',
      permissions: { contents: 'read' },
      outputs: { authorized: '${{ steps.approval.outputs.authorized }}' },
      defaults: bashShellDefaults,
      steps: [
        {
          id: 'approval',
          name: 'Require ordinary approval for the unchanged head',
          env: {
            EXPECTED_HEAD_SHA: '${{ needs.validate-pr-snapshot.outputs.head-sha }}',
            GH_TOKEN: '${{ github.token }}',
            PR_NUMBER: '${{ needs.validate-pr-snapshot.outputs.pr-number }}',
          },
          run: `set -euo pipefail
pr_json=$(gh api "/repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER")
reviews_json=$(gh api --paginate "/repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER/reviews?per_page=100" --slurp | jq -s 'flatten')
authorized=false
if [ "$(jq -r '.state' <<<"$pr_json")" = open ] && \
   [ "$(jq -r '.draft' <<<"$pr_json")" = false ] && \
   [ "$(jq -r '.base.ref' <<<"$pr_json")" = main ] && \
   [ "$(jq -r '.head.repo.full_name' <<<"$pr_json")" = "$GITHUB_REPOSITORY" ] && \
   [ "$(jq -r '.head.sha' <<<"$pr_json")" = "$EXPECTED_HEAD_SHA" ] && \
   jq -e --arg sha "$EXPECTED_HEAD_SHA" 'any(.[]; .state == "APPROVED" and .commit_id == $sha)' <<<"$reviews_json" >/dev/null; then
  authorized=true
fi
echo "authorized=$authorized" >> "$GITHUB_OUTPUT"
echo "Snapshot promotion authorized: $authorized" >> "$GITHUB_STEP_SUMMARY"`,
        },
      ],
    },
    'publish-pr-snapshot': {
      if: "needs.authorize-pr-snapshot.outputs.authorized == 'true'",
      needs: ['validate-pr-snapshot', 'authorize-pr-snapshot'],
      'runs-on': 'ubuntu-24.04',
      concurrency: {
        group: 'pr-snapshot-${{ needs.validate-pr-snapshot.outputs.pr-number }}',
        'cancel-in-progress': false,
      },
      permissions: {
        actions: 'read',
        contents: 'read',
        'id-token': 'write',
      },
      env: {
        ARTIFACT_DIR: '${{ github.workspace }}/tmp/validated-pr-snapshot',
        CACHIX_AUTH_TOKEN: '',
        GH_TOKEN: '${{ github.token }}',
        PUBLISH_LIST: '${{ github.workspace }}/tmp/validated-pr-snapshot/trusted-publish-list.tsv',
      },
      defaults: bashShellDefaults,
      steps: [
        {
          name: 'Use pinned npm trusted-publishing client',
          uses: 'actions/setup-node@v4',
          with: {
            'node-version': '24.15.0',
            'registry-url': 'https://registry.npmjs.org',
          },
        },
        {
          name: 'Download validated promotion artifact',
          uses: 'actions/download-artifact@v4',
          with: {
            name: 'validated-pr-snapshot-${{ needs.validate-pr-snapshot.outputs.head-sha }}-${{ needs.validate-pr-snapshot.outputs.run-id }}',
            path: '${{ github.workspace }}/tmp/validated-pr-snapshot',
          },
        },
        {
          name: 'Recheck unchanged-head approval before OIDC publication',
          env: {
            EXPECTED_HEAD_SHA: '${{ needs.validate-pr-snapshot.outputs.head-sha }}',
            PR_NUMBER: '${{ needs.validate-pr-snapshot.outputs.pr-number }}',
          },
          run: `set -euo pipefail
pr_json=$(gh api "/repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER")
reviews_json=$(gh api --paginate "/repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER/reviews?per_page=100" --slurp | jq -s 'flatten')
test "$(jq -r '.state' <<<"$pr_json")" = open
test "$(jq -r '.draft' <<<"$pr_json")" = false
test "$(jq -r '.head.sha' <<<"$pr_json")" = "$EXPECTED_HEAD_SHA"
jq -e --arg sha "$EXPECTED_HEAD_SHA" 'any(.[]; .state == "APPROVED" and .commit_id == $sha)' <<<"$reviews_json" >/dev/null`,
        },
        {
          name: 'Verify promotion handoff',
          env: { EXPECTED_MANIFEST_DIGEST: '${{ needs.validate-pr-snapshot.outputs.manifest-digest }}' },
          run: `set -euo pipefail
test -f "$ARTIFACT_DIR/manifest.json"
test -f "$PUBLISH_LIST"
actual_manifest_digest=$(sha256sum "$ARTIFACT_DIR/manifest.json" | cut -d' ' -f1)
test "$actual_manifest_digest" = "$EXPECTED_MANIFEST_DIGEST"
jq -r '.packages[] | [.name, .file] | @tsv' "$ARTIFACT_DIR/manifest.json" > "$RUNNER_TEMP/expected-publish-list.tsv"
cmp "$RUNNER_TEMP/expected-publish-list.tsv" "$PUBLISH_LIST"
jq -r '.packages[] | [.file, .sha256] | @tsv' "$ARTIFACT_DIR/manifest.json" |
  while IFS=$'\t' read -r file expected_sha256; do
    [[ "$file" =~ ^[a-zA-Z0-9._-]+[.]tgz$ ]]
    actual_sha256=$(sha256sum "$ARTIFACT_DIR/$file" | cut -d' ' -f1)
    test "$actual_sha256" = "$expected_sha256"
  done
if [ -n "\${NODE_AUTH_TOKEN:-}" ] || [ -n "\${NPM_TOKEN:-}" ]; then
  echo "PR snapshot publishing must use npm trusted publishing; token auth is not allowed." >&2
  exit 1
fi`,
        },
        {
          name: 'Publish exact-SHA package cohort',
          env: {
            SNAPSHOT_TAG: '${{ needs.validate-pr-snapshot.outputs.npm-tag }}',
            SNAPSHOT_VERSION: '${{ needs.validate-pr-snapshot.outputs.version }}',
          },
          run: `set -euo pipefail
while IFS=$'\t' read -r package_name file; do
  test -n "$package_name"
  test -n "$file"
  tarball="$ARTIFACT_DIR/$file"
  local_sha1=$(sha1sum "$tarball" | cut -d' ' -f1)
  if remote_sha1=$(npm view "$package_name@$SNAPSHOT_VERSION" dist.shasum --json --registry=https://registry.npmjs.org 2>/dev/null); then
    remote_sha1=$(jq -r . <<<"$remote_sha1")
    if [ "$remote_sha1" != "$local_sha1" ]; then
      echo "$package_name@$SNAPSHOT_VERSION already exists with a different tarball digest" >&2
      exit 1
    fi
    echo "$package_name@$SNAPSHOT_VERSION already matches candidate; skipping"
    continue
  fi
  npm publish "$tarball" --registry=https://registry.npmjs.org --tag="$SNAPSHOT_TAG" --access=public --ignore-scripts --provenance
done < "$PUBLISH_LIST"`,
        },
        {
          name: 'Record snapshot provenance',
          env: {
            SNAPSHOT_VERSION: '${{ needs.validate-pr-snapshot.outputs.version }}',
            MANIFEST_DIGEST: '${{ needs.validate-pr-snapshot.outputs.manifest-digest }}',
            PACKAGE_COUNT: '${{ needs.validate-pr-snapshot.outputs.package-count }}',
            PR_NUMBER: '${{ needs.validate-pr-snapshot.outputs.pr-number }}',
            SNAPSHOT_TAG: '${{ needs.validate-pr-snapshot.outputs.npm-tag }}',
            SOURCE_RUN_URL: '${{ needs.validate-pr-snapshot.outputs.source-run-url }}',
          },
          run: `cat >> "$GITHUB_STEP_SUMMARY" <<EOF
## Repository-owned PR snapshot

- PR: #$PR_NUMBER
- Head: \`\${{ needs.validate-pr-snapshot.outputs.head-sha }}\`
- Version: \`$SNAPSHOT_VERSION\`
- Immutable npm tag: \`$SNAPSHOT_TAG\`
- Packages: $PACKAGE_COUNT
- Manifest SHA-256: \`$MANIFEST_DIGEST\`
- Source CI run: $SOURCE_RUN_URL
- Candidate attestation: binds the validated package and manifest digests to the exact PR head and source CI run.
- npm provenance: identifies this trusted default-branch promotion workflow; it does not claim that the PR CI job held npm publishing authority.
EOF`,
        },
      ],
    },
    'create-release-pr': {
      if: "github.event_name == 'workflow_dispatch' && inputs.mode == 'create-release-pr'",
      'runs-on': 'ubuntu-latest',
      permissions: {
        actions: 'write',
        contents: 'write',
        'id-token': 'write',
        'pull-requests': 'write',
      },
      defaults: bashShellDefaults,
      steps: [
        {
          name: 'Checkout',
          uses: 'actions/checkout@v4',
          with: {
            ref: 'main',
          },
        },
        ...livestoreSetupSteps.slice(1),
        {
          name: 'Generate release plan from Changesets',
          run: runDevenvTasksBefore('release:changeset:version'),
          env: {
            LIVESTORE_NPM_TAG: '${{ inputs.npm_tag }}',
          },
        },
        {
          /**
           * Extract the changelog section for this release into a reviewable
           * `release/release-notes.md` artifact. The publish job uses this
           * file via `gh release create|edit --notes-file` so the GitHub
           * Release body matches what reviewers approved on the release PR.
           */
          name: 'Extract release notes',
          run: runDevenvTasksBefore('release:notes:extract'),
        },
        {
          name: 'Open release plan PR',
          env: {
            GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
            LIVESTORE_NPM_TAG: '${{ inputs.npm_tag }}',
          },
          run: `set -euo pipefail
LIVESTORE_RELEASE_VERSION="$(jq -r '.version' release/release-plan.json)"
: "\${LIVESTORE_RELEASE_VERSION:?Missing generated release version}"
: "\${LIVESTORE_NPM_TAG:?Missing npm tag}"

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

branch="automation/release-$LIVESTORE_RELEASE_VERSION"
git checkout -B "$branch"
git add \\
  .changeset \\
  package.json \\
  pnpm-lock.yaml \\
  release/devtools-artifact.json \\
  release/release-notes.md \\
  release/release-plan.json \\
  release/version.json \\
  docs/package.json \\
  docs/src/content/_assets/code/package.json \\
  examples \\
  packages \\
  tests

if git diff --cached --quiet; then
  echo "Release plan already current."
else
  git commit -m "Prepare LiveStore $LIVESTORE_RELEASE_VERSION release"
  git fetch origin "refs/heads/$branch:refs/remotes/origin/$branch" || true
  git push --force-with-lease="refs/heads/$branch" origin "$branch"
fi

body="$(cat <<BODY
Prepares a LiveStore release group for $LIVESTORE_RELEASE_VERSION from the pending Changesets.

The release workflow dry-runs the npm publish for the LiveStore packages and the public DevTools artifact repack on this PR. After merge into main, the same workflow publishes the release group. The publish job can also be manually dispatched after an operator verifies that the checked-in release plan is still the intended release.

## Rationale

Release cutting is represented as a reviewable data change instead of a local operator action. Changesets provide the release intent and fixed-group version calculation; LiveStore's existing publisher remains responsible for package provenance and DevTools artifact repacking.
BODY
)"

if gh pr view "$branch" --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1; then
  gh pr edit "$branch" --repo "$GITHUB_REPOSITORY" --title "Prepare LiveStore $LIVESTORE_RELEASE_VERSION release" --body "$body"
else
  gh pr create \\
    --repo "$GITHUB_REPOSITORY" \\
    --base main \\
    --head "$branch" \\
    --title "Prepare LiveStore $LIVESTORE_RELEASE_VERSION release" \\
    --body "$body"
fi

gh workflow run ci.yml --repo "$GITHUB_REPOSITORY" --ref "$branch"
gh workflow run release.yml --repo "$GITHUB_REPOSITORY" --ref "$branch" \\
  -f mode=validate-release-plan \\
  -f npm_tag="$LIVESTORE_NPM_TAG"

# Stable (npm_tag=latest) release PRs are gated by a human reviewer. For
# prerelease channels (dev, next, etc.) the release PR is fully automated, so
# auto-merge is enabled to drive the publish on green CI.
if [ "$LIVESTORE_NPM_TAG" = "latest" ]; then
  echo "npm_tag=latest: leaving auto-merge disabled; this PR requires a human ready-for-review and merge."
elif gh pr view "$branch" --repo "$GITHUB_REPOSITORY" --json autoMergeRequest --jq '.autoMergeRequest != null' | grep -qx true; then
  echo "Auto-merge already enabled for $branch."
else
  gh pr merge "$branch" --repo "$GITHUB_REPOSITORY" --auto --merge
fi`,
        },
      ],
    },

    'validate-release-plan': {
      if: "github.event_name == 'pull_request' || (github.event_name == 'workflow_dispatch' && inputs.mode == 'validate-release-plan')",
      'runs-on': 'ubuntu-24.04',
      defaults: bashShellDefaults,
      steps: withNixDiagnosticsOnFailure([
        ...livestoreSetupSteps,
        {
          name: 'Select release plan for validation',
          run: `set -euo pipefail
use_synthetic_plan=false

if [ "$GITHUB_EVENT_NAME" = "pull_request" ]; then
  git fetch origin "\${{ github.base_ref }}" --depth=1
  if ! git diff --name-only "origin/\${{ github.base_ref }}...HEAD" | grep -qx 'release/release-plan.json'; then
    use_synthetic_plan=true
  fi
elif [ ! -f release/release-plan.json ]; then
  use_synthetic_plan=true
fi

if [ "$use_synthetic_plan" = "false" ]; then
  exit 0
fi

mkdir -p release
# PRs that touch release machinery but do not carry an actual release plan still
# need to exercise package publishing and DevTools repacking. Use a unique,
# unpublished prerelease instead of the checked-in package version: current dev
# versions can already exist on npm, while snapshot versions intentionally
# belong to the separate snapshot publisher.
short_sha="\${GITHUB_SHA:0:12}"
version="0.0.0-ci.release-validation.$short_sha"
npm_tag="next"
jq -n \\
  --arg version "$version" \\
  --arg npmTag "$npm_tag" \\
  '{
    schemaVersion: 1,
    version: $version,
    npmTag: $npmTag
  }' > release/release-plan.json`,
        },
        {
          name: 'Dry-run stable package publish',
          run: runDevenvTasksBefore('release:stable:dryrun'),
        },
        {
          name: 'Read release plan',
          run: `set -euo pipefail
release_version="$(jq -r '.version' release/release-plan.json)"
npm_tag="$(jq -r '.npmTag' release/release-plan.json)"
: "\${release_version:?Missing release version}"
: "\${npm_tag:?Missing npm tag}"
echo "LIVESTORE_RELEASE_VERSION=$release_version" >> "$GITHUB_ENV"
echo "LIVESTORE_NPM_TAG=$npm_tag" >> "$GITHUB_ENV"
if [ "$npm_tag" = "latest" ]; then
  echo "LIVESTORE_RELEASE_DEPLOY_TARGET=prod" >> "$GITHUB_ENV"
else
  echo "LIVESTORE_RELEASE_DEPLOY_TARGET=dev" >> "$GITHUB_ENV"
fi`,
        },
        {
          name: 'Certify DevTools artifact liveness',
          run: runDevenvTasksBefore('release:devtools-artifact:certify-liveness:no-install'),
        },
        devtoolsCertificationArtifactsStep,
        {
          name: 'Dry-run DevTools artifact repack',
          run: runDevenvTasksBefore('release:devtools-artifact:repack-dryrun:no-install'),
        },
      ]),
    },

    'publish-release': {
      if: "github.event_name == 'push' || (github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && inputs.mode == 'publish-release')",
      'runs-on': 'ubuntu-24.04',
      permissions: {
        contents: 'write',
        'id-token': 'write',
      },
      env: {
        GH_TOKEN: '${{ github.token }}',
      },
      defaults: bashShellDefaults,
      steps: withNixDiagnosticsOnFailure([
        ...livestoreSetupSteps,
        {
          name: 'Read release plan',
          run: `set -euo pipefail
release_version="$(jq -r '.version' release/release-plan.json)"
npm_tag="$(jq -r '.npmTag' release/release-plan.json)"
: "\${release_version:?Missing release version}"
: "\${npm_tag:?Missing npm tag}"
echo "LIVESTORE_RELEASE_VERSION=$release_version" >> "$GITHUB_ENV"
echo "LIVESTORE_NPM_TAG=$npm_tag" >> "$GITHUB_ENV"
# Env vars do not carry across jobs in GitHub Actions, so the deploy-target
# gate that the validate-release-plan job sets must be re-derived here for the
# Deploy production docs/examples and Sync production docs search steps below.
if [ "$npm_tag" = "latest" ]; then
  echo "LIVESTORE_RELEASE_DEPLOY_TARGET=prod" >> "$GITHUB_ENV"
else
  echo "LIVESTORE_RELEASE_DEPLOY_TARGET=dev" >> "$GITHUB_ENV"
fi`,
        },
        {
          name: 'Assert tokenless npm trusted publishing',
          run: `set -euo pipefail
if [ -n "\${NODE_AUTH_TOKEN:-}" ] || [ -n "\${NPM_TOKEN:-}" ]; then
  echo "npm publishing must use trusted publishing; token auth is not allowed in this job." >&2
  exit 1
fi`,
        },
        otelSetupStep,
        {
          name: 'Publish stable package release',
          run: runDevenvTasksBefore('release:stable:publish'),
        },
        {
          name: 'Certify DevTools artifact liveness',
          run: runDevenvTasksBefore('release:devtools-artifact:certify-liveness:no-install'),
        },
        devtoolsCertificationArtifactsStep,
        {
          name: 'Publish DevTools artifact release',
          run: runDevenvTasksBefore('release:devtools-artifact:publish:no-install'),
        },
        /*
         * Prod docs deploy — phase-split with OS-level shell timeouts +
         * heartbeats to cap orphan Chromium children from the tldraw render
         * step (livestorejs/livestore#1279). Each phase has its own
         * `timeout-minutes` backstop above the per-task `timeout(1)` wrapper.
         *
         * If a phase fails or hangs, an operator can recover with
         * `gh workflow run deploy-prod.yml -f target=docs` instead of
         * re-running the entire publish chain.
         */
        {
          // Option A: a single `netlify deploy --build` runs the full
          // `@netlify/build` pipeline (framework build incl. snippets/diagrams +
          // serverless/edge bundling) and uploads, then writes deploy-state.json.
          name: 'Deploy production docs — build + deploy',
          if: "env.LIVESTORE_RELEASE_DEPLOY_TARGET == 'prod'",
          'timeout-minutes': 30,
          run: runDevenvTasksBefore('docs:deploy:prod:phase:build-deploy'),
          env: {
            NETLIFY_AUTH_TOKEN: '${{ secrets.NETLIFY_AUTH_TOKEN }}',
          },
        },
        {
          name: 'Deploy production docs — verify',
          if: "env.LIVESTORE_RELEASE_DEPLOY_TARGET == 'prod'",
          'timeout-minutes': 15,
          run: runDevenvTasksBefore('docs:deploy:prod:phase:verify'),
          env: {
            NETLIFY_AUTH_TOKEN: '${{ secrets.NETLIFY_AUTH_TOKEN }}',
          },
        },
        {
          name: 'Deploy production docs — purge CDN',
          if: "env.LIVESTORE_RELEASE_DEPLOY_TARGET == 'prod'",
          'timeout-minutes': 15,
          run: runDevenvTasksBefore('docs:deploy:prod:phase:purge'),
          env: {
            NETLIFY_AUTH_TOKEN: '${{ secrets.NETLIFY_AUTH_TOKEN }}',
          },
        },
        {
          name: 'Collect docs deploy diagnostics on failure',
          if: "${{ failure() && env.LIVESTORE_RELEASE_DEPLOY_TARGET == 'prod' }}",
          run: runDevenvTasksBefore('docs:deploy:prod:diagnostics'),
        },
        {
          name: 'Upload docs prod deploy logs',
          if: "${{ always() && env.LIVESTORE_RELEASE_DEPLOY_TARGET == 'prod' }}",
          uses: 'actions/upload-artifact@v4',
          with: {
            name: 'docs-prod-deploy-logs-${{ github.run_id }}-${{ github.run_attempt }}',
            path: 'tmp/ci-docs-prod/',
            'if-no-files-found': 'ignore',
            'retention-days': 14,
          },
        },
        {
          name: 'Deploy production examples',
          if: "env.LIVESTORE_RELEASE_DEPLOY_TARGET == 'prod'",
          'timeout-minutes': 30,
          run: runDevenvTasksBefore('examples:deploy:prod'),
          env: {
            CLOUDFLARE_API_TOKEN: '${{ secrets.CLOUDFLARE_API_TOKEN }}',
            CLOUDFLARE_ACCOUNT_ID: '${{ secrets.CLOUDFLARE_ACCOUNT_ID }}',
          },
        },
        {
          name: 'Sync production docs search',
          if: "env.LIVESTORE_RELEASE_DEPLOY_TARGET == 'prod'",
          'timeout-minutes': 15,
          run: runDevenvTasksBefore('docs:search:sync:prod'),
          env: {
            MXBAI_API_KEY: '${{ secrets.MXBAI_API_KEY }}',
            MXBAI_VECTOR_STORE_ID: '${{ secrets.MXBAI_VECTOR_STORE_ID }}',
          },
        },
      ]),
    },

    /**
     * Keep npm publishing in release.yml so each package has a single npm
     * trusted-publisher workflow. The heavy CI matrix remains in ci.yml; this
     * job runs only after that workflow succeeds on main, or by explicit
     * workflow_dispatch for operator-controlled recovery.
     */
    'publish-snapshot-version': {
      if: "(github.event_name == 'workflow_run' && github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'push') || (github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && inputs.mode == 'publish-snapshot')",
      'runs-on': 'ubuntu-24.04',
      permissions: {
        contents: 'write',
        'id-token': 'write',
      },
      env: {
        GH_TOKEN: '${{ github.token }}',
      },
      defaults: bashShellDefaults,
      steps: withNixDiagnosticsOnFailure([
        {
          name: 'Checkout',
          uses: 'actions/checkout@v4',
          with: {
            ref: RELEASE_HEAD_SHA,
          },
        },
        ...livestoreSetupSteps.slice(1),
        {
          name: 'Assert tokenless npm trusted publishing',
          run: `set -euo pipefail
if [ -n "\${NODE_AUTH_TOKEN:-}" ] || [ -n "\${NPM_TOKEN:-}" ]; then
  echo "npm snapshot publishing must use trusted publishing; token auth is not allowed in this job." >&2
  exit 1
fi`,
        },
        {
          name: 'Publish snapshot version',
          run: runDevenvTasksBefore('release:snapshot:git-sha'),
          env: { GIT_SHA: RELEASE_HEAD_SHA },
        },
        {
          name: 'Publish DevTools artifact snapshot',
          run: runDevenvTasksBefore('release:devtools-artifact:publish'),
          env: {
            LIVESTORE_DEVTOOLS_OUT_DIR: '${{ runner.temp }}/livestore-devtools-snapshot',
            LIVESTORE_RELEASE_VERSION: `0.0.0-snapshot-${RELEASE_HEAD_SHA}`,
          },
        },
        {
          name: 'Upload DevTools Chrome snapshot artifact',
          uses: 'actions/upload-artifact@v4',
          with: {
            name: `livestore-devtools-chrome-0.0.0-snapshot-${RELEASE_HEAD_SHA}`,
            path: '${{ runner.temp }}/livestore-devtools-snapshot/livestore-devtools-chrome-0.0.0-snapshot-${{ github.event.workflow_run.head_sha || github.sha }}.zip',
            'if-no-files-found': 'error',
            'retention-days': 14,
          },
        },
      ]),
    },
  },
})
