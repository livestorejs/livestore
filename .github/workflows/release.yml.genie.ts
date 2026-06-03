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
  '.github/workflows/validate-publish-substance.yml',
  '.github/workflows/validate-publish-substance.yml.genie.ts',
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
    'source-policy': livestoreDefaultRefPolicyJob,
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

    /**
     * Stable release validation. Delegates to the reusable
     * `validate-publish-substance.yml` workflow so the plan-source selection
     * + version/tag/deploy-target derivation is shared with the snapshot
     * substance check in `ci.yml`. Decides between the checked-in
     * `release/release-plan.json` and a synthetic plan based on whether the
     * PR actually edits the plan file.
     */
    'select-plan-source': {
      if: "github.event_name == 'pull_request' || (github.event_name == 'workflow_dispatch' && inputs.mode == 'validate-release-plan')",
      'runs-on': 'ubuntu-24.04',
      defaults: bashShellDefaults,
      outputs: {
        'release-plan-source': '${{ steps.choose.outputs.release-plan-source }}',
      },
      steps: [
        { name: 'Checkout', uses: 'actions/checkout@v4' },
        {
          id: 'choose',
          name: 'Decide whether to use the committed plan or a synthetic one',
          run: `set -euo pipefail
source="plan-file"

if [ "$GITHUB_EVENT_NAME" = "pull_request" ]; then
  git fetch origin "\${{ github.base_ref }}" --depth=1
  if ! git diff --name-only "origin/\${{ github.base_ref }}...HEAD" | grep -qx 'release/release-plan.json'; then
    source="synthetic"
  fi
elif [ ! -f release/release-plan.json ]; then
  source="synthetic"
fi

echo "release-plan-source=$source" >> "$GITHUB_OUTPUT"
echo "Selected release-plan-source=$source"`,
        },
      ],
    },

    'validate-release-plan': {
      if: "github.event_name == 'pull_request' || (github.event_name == 'workflow_dispatch' && inputs.mode == 'validate-release-plan')",
      needs: 'select-plan-source',
      uses: './.github/workflows/validate-publish-substance.yml',
      with: {
        'release-plan-source': '${{ needs.select-plan-source.outputs.release-plan-source }}',
        'target-scope': 'stable',
      },
      secrets: 'inherit',
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
          /**
           * TODO(#1278-followup): Migrate this job to `uses:
           * ./.github/workflows/validate-publish-substance.yml` so the version /
           * tag / deploy-target triple is sourced from typed workflow_call
           * outputs instead of re-derived here. Kept inline for now because the
           * publish-release job has many downstream steps that still read these
           * values as `env.LIVESTORE_RELEASE_DEPLOY_TARGET` — migrating them is
           * a separate change.
           *
           * The duplicated jq/case block below intentionally mirrors the
           * `Derive release-version / npm-tag / deploy-target outputs` step in
           * `validate-publish-substance.yml`. Any change to the mapping must be
           * applied in both places until the migration completes.
           */
          name: 'Read release plan',
          run: `set -euo pipefail
release_version="$(jq -r '.version' release/release-plan.json)"
npm_tag="$(jq -r '.npmTag' release/release-plan.json)"
: "\${release_version:?Missing release version}"
: "\${npm_tag:?Missing npm tag}"
echo "LIVESTORE_RELEASE_VERSION=$release_version" >> "$GITHUB_ENV"
echo "LIVESTORE_NPM_TAG=$npm_tag" >> "$GITHUB_ENV"
# Env vars do not carry across jobs in GitHub Actions, so the deploy-target
# gate that the validate-release-plan job derives must be re-derived here for
# the Deploy production docs/examples and Sync production docs search steps
# below. Tracked by #1278 follow-up above.
case "$npm_tag" in
  latest) echo "LIVESTORE_RELEASE_DEPLOY_TARGET=prod" >> "$GITHUB_ENV" ;;
  dev)    echo "LIVESTORE_RELEASE_DEPLOY_TARGET=dev"  >> "$GITHUB_ENV" ;;
  *)      echo "LIVESTORE_RELEASE_DEPLOY_TARGET=none" >> "$GITHUB_ENV" ;;
esac`,
        },
        /*
         * Stable package publishing uses the NPM_TOKEN secret. npm currently
         * allows only one trusted publisher workflow per package, and
         * `ci.yml` already owns that slot for snapshot publishing. Moving
         * stable releases to trusted publishing would require consolidating
         * the snapshot + stable publish into a single workflow file or
         * giving up snapshot OIDC — neither is worth doing right now.
         * See .github/workflows/README.md `release.yml` section.
         */
        {
          name: 'Configure npm token fallback',
          run: `set -euo pipefail
: "\${NODE_AUTH_TOKEN:?Missing NPM_TOKEN secret}"
npmrc="$HOME/.npmrc"
printf '%s\\n' "always-auth=true" > "$npmrc"
printf '%s\\n' "//registry.npmjs.org/:_authToken=$NODE_AUTH_TOKEN" >> "$npmrc"
printf '%s\\n' "NPM_CONFIG_USERCONFIG=$npmrc" >> "$GITHUB_ENV"
printf '%s\\n' "NPM_CONFIG_REGISTRY=https://registry.npmjs.org/" >> "$GITHUB_ENV"
NPM_CONFIG_USERCONFIG="$npmrc" NPM_CONFIG_REGISTRY=https://registry.npmjs.org/ npm whoami >/dev/null`,
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
          name: 'Deploy production docs — snippets',
          if: "env.LIVESTORE_RELEASE_DEPLOY_TARGET == 'prod'",
          'timeout-minutes': 25,
          run: runDevenvTasksBefore('docs:deploy:prod:phase:snippets'),
        },
        {
          name: 'Deploy production docs — diagrams',
          if: "env.LIVESTORE_RELEASE_DEPLOY_TARGET == 'prod'",
          'timeout-minutes': 25,
          run: runDevenvTasksBefore('docs:deploy:prod:phase:diagrams'),
        },
        {
          name: 'Deploy production docs — astro build',
          if: "env.LIVESTORE_RELEASE_DEPLOY_TARGET == 'prod'",
          'timeout-minutes': 25,
          run: runDevenvTasksBefore('docs:deploy:prod:phase:astro'),
        },
        {
          name: 'Deploy production docs — upload',
          if: "env.LIVESTORE_RELEASE_DEPLOY_TARGET == 'prod'",
          'timeout-minutes': 25,
          run: runDevenvTasksBefore('docs:deploy:prod:phase:upload'),
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
  },
})
