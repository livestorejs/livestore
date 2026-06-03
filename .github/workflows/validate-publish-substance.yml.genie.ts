/**
 * Reusable workflow: validate that the release/publish substance is consistent
 * with the declared release plan.
 *
 * Called by:
 *   - `release.yml#validate-release-plan` — stable release path (PRs + dispatch).
 *   - `ci.yml#validate-snapshot-substance` — snapshot rehearsal path on PRs.
 *
 * Why this exists (livestorejs/livestore#1278):
 *   The pre-refactor world hand-rolled an `echo X=Y >> $GITHUB_ENV` block in two
 *   places (`validate-release-plan` and `publish-release`) to derive
 *   `LIVESTORE_RELEASE_VERSION` / `LIVESTORE_NPM_TAG` /
 *   `LIVESTORE_RELEASE_DEPLOY_TARGET` from `release/release-plan.json`. Env vars
 *   do not carry across jobs, so each downstream job had to re-derive them. The
 *   `LIVESTORE_RELEASE_DEPLOY_TARGET` line got dropped on one path and the
 *   `Deploy production *` steps silently skipped — a propagation bug that the
 *   compiler cannot represent away.
 *
 *   Modelling this as a reusable workflow with typed `inputs` / `outputs` makes
 *   the cross-job state explicit and untestable bugs in the propagation layer
 *   disappear: dependent jobs read
 *   `needs.<job>.outputs.release-version` etc., and the schema fails CI if a
 *   caller forgets to wire an output.
 *
 * Required upstream change:
 *   @overeng/genie modelled `Job` as steps-only until this refactor. The
 *   companion PR (`overengineeringstudio/effect-utils#735`) adds `JobWithUses`
 *   so callers can express `uses: ./.github/workflows/<name>.yml` jobs.
 */
import {
  bashShellDefaults,
  defaultActionlintConfig,
  githubWorkflow,
  livestoreSetupSteps,
  nixDiagnosticsArtifactStep,
  runDevenvTasksBefore,
  savePnpmStateStep,
} from '../../genie/repo.ts'

const withNixDiagnosticsOnFailure = (steps: unknown[]) => [
  ...steps,
  savePnpmStateStep({ keyPrefix: 'livestore-pnpm-state-v1' }),
  nixDiagnosticsArtifactStep(),
]

/**
 * Playwright artifacts produced by `release:devtools-artifact:certify-liveness`.
 * Uploaded unconditionally so failures surface the screenshots/reports that
 * make liveness regressions debuggable.
 */
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

export default githubWorkflow({
  name: 'Validate publish substance (reusable)',
  actionlint: defaultActionlintConfig,

  on: {
    workflow_call: {
      inputs: {
        /**
         * `plan-file` reads `release/release-plan.json` from the checked-out
         * tree. `synthetic` writes a unique `0.0.0-...` plan first so PRs that
         * touch release machinery (without an actual release plan) can still
         * exercise the publish pipeline end-to-end.
         */
        'release-plan-source': {
          description: 'Where the release plan comes from: plan-file | synthetic',
          required: true,
          type: 'string',
        },
        /**
         * Prefix for the synthetic version when `release-plan-source = synthetic`.
         * Final version is `<prefix>.<short-sha>`, e.g.
         * `0.0.0-ci.release-validation` → `0.0.0-ci.release-validation.abc123def456`.
         */
        'synthetic-version-prefix': {
          description: 'Version prefix for synthetic plans (only used when release-plan-source=synthetic)',
          required: false,
          default: '0.0.0-ci.release-validation',
          type: 'string',
        },
        /**
         * Identifies which higher-level pipeline is calling, used for
         * observability and to gate behaviour that differs between paths.
         * Currently informational; reserved for future per-scope branching.
         */
        'target-scope': {
          description: 'Caller scope: stable | snapshot | rehearsal',
          required: true,
          type: 'string',
        },
        /**
         * Force the npm tag, overriding whatever the plan/synthesizer chose.
         * Empty string means "no override; use the value from the plan."
         */
        'npm-tag-override': {
          description: 'Optional npm tag override (empty string = no override)',
          required: false,
          default: '',
          type: 'string',
        },
      },
      outputs: {
        'release-version': {
          description: 'Version string from the validated release plan',
          value: '${{ jobs.validate.outputs.release-version }}',
        },
        'npm-tag': {
          description: 'npm dist-tag from the validated release plan',
          value: '${{ jobs.validate.outputs.npm-tag }}',
        },
        /**
         * Where prod deploys are eligible to run. `latest` -> prod,
         * `dev` -> dev, anything else -> none. Callers gate their deploy
         * steps on this output instead of re-deriving from `npm-tag`.
         */
        'deploy-target': {
          description: 'prod | dev | none (derived once from npm-tag)',
          value: '${{ jobs.validate.outputs.deploy-target }}',
        },
      },
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
    validate: {
      'runs-on': 'ubuntu-24.04',
      outputs: {
        'release-version': '${{ steps.derive.outputs.release-version }}',
        'npm-tag': '${{ steps.derive.outputs.npm-tag }}',
        'deploy-target': '${{ steps.derive.outputs.deploy-target }}',
      },
      defaults: bashShellDefaults,
      steps: withNixDiagnosticsOnFailure([
        ...livestoreSetupSteps,
        {
          name: 'Materialize release plan',
          env: {
            RELEASE_PLAN_SOURCE: '${{ inputs.release-plan-source }}',
            SYNTHETIC_VERSION_PREFIX: '${{ inputs.synthetic-version-prefix }}',
          },
          run: `set -euo pipefail
case "$RELEASE_PLAN_SOURCE" in
  plan-file)
    if [ ! -f release/release-plan.json ]; then
      echo "release-plan-source=plan-file but release/release-plan.json is missing" >&2
      exit 1
    fi
    ;;
  synthetic)
    mkdir -p release
    short_sha="\${GITHUB_SHA:0:12}"
    version="\${SYNTHETIC_VERSION_PREFIX}.\${short_sha}"
    # Snapshot/rehearsal plans publish under the \`next\` dist-tag so they never
    # collide with the \`latest\` or \`dev\` channels the production release
    # pipeline owns.
    npm_tag="next"
    jq -n \\
      --arg version "$version" \\
      --arg npmTag "$npm_tag" \\
      '{ schemaVersion: 1, version: $version, npmTag: $npmTag }' \\
      > release/release-plan.json
    ;;
  *)
    echo "Unknown release-plan-source: $RELEASE_PLAN_SOURCE (expected: plan-file | synthetic)" >&2
    exit 1
    ;;
esac`,
        },
        {
          /**
           * Single source of truth for the version / tag / deploy-target
           * triple. Callers get these as typed `needs.<job>.outputs.*` values
           * instead of having to repeat this jq + tag-mapping shell block in
           * every downstream job.
           */
          id: 'derive',
          name: 'Derive release-version / npm-tag / deploy-target outputs',
          env: {
            NPM_TAG_OVERRIDE: '${{ inputs.npm-tag-override }}',
          },
          run: `set -euo pipefail
release_version="$(jq -r '.version' release/release-plan.json)"
npm_tag="$(jq -r '.npmTag' release/release-plan.json)"
: "\${release_version:?Missing release version}"
: "\${npm_tag:?Missing npm tag}"

if [ -n "$NPM_TAG_OVERRIDE" ]; then
  npm_tag="$NPM_TAG_OVERRIDE"
fi

# Canonical npm-tag -> deploy-target mapping. Previously inlined in three
# places (validate-release-plan, publish-release, deploy-prod).
case "$npm_tag" in
  latest) deploy_target="prod" ;;
  dev)    deploy_target="dev"  ;;
  *)      deploy_target="none" ;;
esac

echo "release-version=$release_version" >> "$GITHUB_OUTPUT"
echo "npm-tag=$npm_tag" >> "$GITHUB_OUTPUT"
echo "deploy-target=$deploy_target" >> "$GITHUB_OUTPUT"

echo "Resolved: version=$release_version npm-tag=$npm_tag deploy-target=$deploy_target"`,
        },
        {
          name: 'Dry-run stable package publish',
          run: runDevenvTasksBefore('release:stable:dryrun'),
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
  },
})
