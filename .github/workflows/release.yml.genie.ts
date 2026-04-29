import {
  bashShellDefaults,
  defaultActionlintConfig,
  githubWorkflow,
  livestoreSetupSteps,
  runDevenvTasksBefore,
  savePnpmStateStep,
  nixDiagnosticsArtifactStep,
} from '../../genie/repo.ts'

const withNixDiagnosticsOnFailure = (steps: unknown[]) => [
  ...steps,
  savePnpmStateStep({ keyPrefix: 'livestore-pnpm-state-v1' }),
  nixDiagnosticsArtifactStep(),
]

const releasePlanPaths = [
  '.github/workflows/release.yml',
  '.github/workflows/release.yml.genie.ts',
  'genie/repo.ts',
  'nix/devenv-modules/tasks/local/mono-wrappers.nix',
  'release/release-plan.json',
  'release/version.json',
  'release/devtools-artifact.json',
  'scripts/src/commands/release.ts',
  'scripts/src/commands/devtools-artifact.ts',
  'scripts/src/commands/changesets.ts',
]

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
          options: ['create-release-pr', 'validate-release-plan'],
        },
      },
    },
    pull_request: {
      paths: releasePlanPaths,
    },
    push: {
      branches: ['dev'],
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
            ref: 'dev',
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

The release workflow dry-runs the npm publish for the LiveStore packages and the public DevTools artifact repack on this PR. After merge into dev, the same workflow publishes the release group.

## Rationale

Release cutting is represented as a reviewable data change instead of a local operator action. Changesets provide the release intent and fixed-group version calculation; LiveStore's existing publisher remains responsible for package provenance and DevTools artifact repacking.
BODY
)"

if gh pr view "$branch" --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1; then
  gh pr edit "$branch" --repo "$GITHUB_REPOSITORY" --title "Prepare LiveStore $LIVESTORE_RELEASE_VERSION release" --body "$body"
else
  gh pr create \\
    --repo "$GITHUB_REPOSITORY" \\
    --base dev \\
    --head "$branch" \\
    --title "Prepare LiveStore $LIVESTORE_RELEASE_VERSION release" \\
    --body "$body"
fi

gh workflow run ci.yml --repo "$GITHUB_REPOSITORY" --ref "$branch"
gh workflow run release.yml --repo "$GITHUB_REPOSITORY" --ref "$branch" \\
  -f mode=validate-release-plan \\
  -f npm_tag="$LIVESTORE_NPM_TAG"`,
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
          name: 'Create synthetic release plan when testing release tooling changes',
          run: `set -euo pipefail
if [ -f release/release-plan.json ]; then
  exit 0
fi

mkdir -p release
jq -n \\
  --arg version "0.0.0-release-workflow-test-\${GITHUB_SHA}" \\
  --arg npmTag "next" \\
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
: "\${release_version:?Missing release version}"
echo "LIVESTORE_RELEASE_VERSION=$release_version" >> "$GITHUB_ENV"`,
        },
        {
          name: 'Dry-run DevTools artifact repack',
          run: runDevenvTasksBefore('release:devtools-artifact:repack-dryrun:no-install'),
        },
      ]),
    },

    'publish-release': {
      if: "github.event_name == 'push'",
      'runs-on': 'ubuntu-24.04',
      permissions: {
        contents: 'read',
        'id-token': 'write',
      },
      defaults: bashShellDefaults,
      steps: withNixDiagnosticsOnFailure([
        ...livestoreSetupSteps,
        {
          name: 'Read release plan',
          run: `set -euo pipefail
release_version="$(jq -r '.version' release/release-plan.json)"
: "\${release_version:?Missing release version}"
echo "LIVESTORE_RELEASE_VERSION=$release_version" >> "$GITHUB_ENV"`,
        },
        {
          name: 'Publish stable package release',
          run: runDevenvTasksBefore('release:stable:publish'),
        },
        {
          name: 'Publish DevTools artifact release',
          run: runDevenvTasksBefore('release:devtools-artifact:publish:no-install'),
        },
      ]),
    },
  },
})
