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
          options: ['create-release-pr', 'validate-release-plan', 'publish-release'],
        },
      },
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
          name: 'Dry-run DevTools artifact repack',
          run: runDevenvTasksBefore('release:devtools-artifact:repack-dryrun:no-install'),
        },
      ]),
    },

    'publish-release': {
      if: "github.event_name == 'push' || (github.event_name == 'workflow_dispatch' && inputs.mode == 'publish-release')",
      'runs-on': 'ubuntu-24.04',
      permissions: {
        contents: 'write',
        'id-token': 'write',
      },
      env: {
        GH_TOKEN: '${{ github.token }}',
        NODE_AUTH_TOKEN: '${{ secrets.NPM_TOKEN }}',
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
          name: 'Configure npm token fallback',
          run: `set -euo pipefail
: "\${NODE_AUTH_TOKEN:?Missing NPM_TOKEN secret}"
printf '%s\\n' "always-auth=true" > "$HOME/.npmrc"
printf '%s\\n' "//registry.npmjs.org/:_authToken=$NODE_AUTH_TOKEN" >> "$HOME/.npmrc"`,
        },
        {
          name: 'Publish stable package release',
          run: runDevenvTasksBefore('release:stable:publish'),
        },
        {
          name: 'Publish DevTools artifact release',
          run: runDevenvTasksBefore('release:devtools-artifact:publish:no-install'),
        },
        {
          name: 'Deploy production docs',
          if: "env.LIVESTORE_RELEASE_DEPLOY_TARGET == 'prod'",
          run: runDevenvTasksBefore('docs:deploy:prod'),
          env: {
            NETLIFY_AUTH_TOKEN: '${{ secrets.NETLIFY_AUTH_TOKEN }}',
          },
        },
        {
          name: 'Deploy production examples',
          if: "env.LIVESTORE_RELEASE_DEPLOY_TARGET == 'prod'",
          run: runDevenvTasksBefore('examples:deploy:prod'),
          env: {
            CLOUDFLARE_API_TOKEN: '${{ secrets.CLOUDFLARE_API_TOKEN }}',
            CLOUDFLARE_ACCOUNT_ID: '${{ secrets.CLOUDFLARE_ACCOUNT_ID }}',
          },
        },
        {
          name: 'Sync production docs search',
          if: "env.LIVESTORE_RELEASE_DEPLOY_TARGET == 'prod'",
          run: `set -euo pipefail
: "\${MXBAI_API_KEY:?Missing MXBAI_API_KEY secret}"
: "\${MXBAI_VECTOR_STORE_ID_PROD:?Missing MXBAI_VECTOR_STORE_ID_PROD secret}"
pnpm --dir docs exec mxbai store sync "$MXBAI_VECTOR_STORE_ID_PROD" "./src/content/**/*.mdx" "./src/content/**/*.md" --yes --strategy fast`,
          env: {
            MXBAI_API_KEY: '${{ secrets.MXBAI_API_KEY }}',
            MXBAI_VECTOR_STORE_ID_PROD: '${{ secrets.MXBAI_VECTOR_STORE_ID_PROD }}',
          },
        },
      ]),
    },
  },
})
