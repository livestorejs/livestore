import { releaseTopologyPath } from '../../genie/pr-snapshot-paths.ts'
import { bashShellDefaults, livestoreSetupSteps, runDevenvTasksBefore } from '../../genie/repo.ts'

// The complete credentialed surface. Artifact contents are data, never executable code.
const publishShell = `set -euo pipefail
if [ -n "\${NODE_AUTH_TOKEN:-}" ] || [ -n "\${NPM_TOKEN:-}" ]; then
  echo "npm publishing must use trusted publishing; token auth is not allowed in this job." >&2
  exit 1
fi
actual="$(openssl dgst -sha512 -binary "$ARTIFACT_DIR/manifest.json" | openssl base64 -A)"
test "$actual" = "$MANIFEST_SHA512" || { echo "Validated manifest changed" >&2; exit 1; }
jq -r '.packages[] | [.name,.version,.filename,.integrity,.tag] | @tsv' "$ARTIFACT_DIR/manifest.json" > "$RUNNER_TEMP/publish-plan.tsv"
while IFS=$'\\t' read -r name version filename integrity tag; do
  test ! -L "$ARTIFACT_DIR/$filename" && test -f "$ARTIFACT_DIR/$filename"
  actual="sha512-$(openssl dgst -sha512 -binary "$ARTIFACT_DIR/$filename" | openssl base64 -A)"
  test "$actual" = "$integrity" || { echo "Tarball integrity mismatch: $filename" >&2; exit 1; }
done < "$RUNNER_TEMP/publish-plan.tsv"
registry_integrity() {
  local result
  if result="$(npm view "$1" dist.integrity --json --registry https://registry.npmjs.org 2>"$RUNNER_TEMP/npm-view-error")"; then
    jq -er 'select(type == "string")' <<< "$result"
  elif grep -q 'E404' "$RUNNER_TEMP/npm-view-error"; then
    return 0
  else
    cat "$RUNNER_TEMP/npm-view-error" >&2
    return 1
  fi
}
while IFS=$'\\t' read -r name version filename integrity tag; do
  spec="$name@$version"
  existing="$(registry_integrity "$spec")"
  if [ -n "$existing" ]; then
    test "$existing" = "$integrity" || { echo "$spec already exists with DIFFERENT integrity" >&2; exit 1; }
    current="$(npm view "$name" "dist-tags.$tag" --json --registry https://registry.npmjs.org)"
    test "$(jq -r . <<< "$current")" = "$version" || { echo "$spec has a stale $tag dist-tag; refusing rerun" >&2; exit 1; }
    echo "$spec already published with matching integrity and tag; skipping"
    continue
  fi
  if ! npm publish "$ARTIFACT_DIR/$filename" --ignore-scripts --provenance --access public --tag "$tag" --registry https://registry.npmjs.org >"$RUNNER_TEMP/npm-publish-log" 2>&1; then
    cat "$RUNNER_TEMP/npm-publish-log" >&2
    echo "$spec publish failed; staging may require human approval. See context/03-delivery/02-release/release-workflows-runbook.md#npm-visibility-and-staged-publish-recovery. Rerun this failed job with its original artifact." >&2
    exit 1
  fi
  cat "$RUNNER_TEMP/npm-publish-log"
  existing="$(registry_integrity "$spec")"
  test "$existing" = "$integrity" || {
    echo "$spec is not public with matching integrity. See context/03-delivery/02-release/release-workflows-runbook.md#npm-visibility-and-staged-publish-recovery." >&2
    exit 1
  }
  current="$(npm view "$name" "dist-tags.$tag" --json --registry https://registry.npmjs.org)"
  test "$(jq -r . <<< "$current")" = "$version" || { echo "$spec has a stale $tag dist-tag" >&2; exit 1; }
done < "$RUNNER_TEMP/publish-plan.tsv"`

export const releaseArtifactJobs = ({
  suffix,
  condition,
  stable,
  releaseHeadSha,
}: {
  suffix: string
  condition: string
  stable: boolean
  releaseHeadSha: string
}) => {
  const prepare = `prepare-${suffix}`
  const validate = `validate-${suffix}`
  const publish = `publish-${suffix}`
  const output = (job: string, key: string) => `\${{ needs['${job}'].outputs.${key} }}`
  const download = {
    uses: 'actions/download-artifact@v4',
    with: { name: `npm-release-${suffix}`, path: '${{ runner.temp }}/release-artifact' },
  }
  // Emit the same selection in both jobs; validation executes it independently at the source SHA.
  const selectExpectedMetadata =
    stable === true
      ? `version="$(jq -er '.version' release/release-plan.json)"
npm_tag="$(jq -er '.npmTag' release/release-plan.json)"`
      : `version="0.0.0-snapshot-$SOURCE_SHA"
npm_tag=snapshot`
  return {
    [prepare]: {
      if: condition,
      'runs-on': 'ubuntu-24.04',
      permissions: { contents: 'read' },
      defaults: bashShellDefaults,
      steps: [
        { uses: 'actions/checkout@v4', with: { ref: releaseHeadSha, 'persist-credentials': false } },
        ...livestoreSetupSteps.slice(1),
        {
          name: 'Select exact release candidate',
          env: { SOURCE_SHA: releaseHeadSha },
          run: `set -euo pipefail
test "$(git rev-parse HEAD)" = "$SOURCE_SHA"
${selectExpectedMetadata}
echo "LIVESTORE_RELEASE_VERSION=$version" >> "$GITHUB_ENV"
echo "LIVESTORE_NPM_TAG=$npm_tag" >> "$GITHUB_ENV"
echo "RELEASE_ARTIFACT_DIR=$RUNNER_TEMP/release-artifact" >> "$GITHUB_ENV"`,
        },
        { name: 'Build and pack core packages', run: runDevenvTasksBefore('release:artifact:pack') },
        ...(stable === true
          ? [
              {
                name: 'Certify DevTools artifact liveness',
                run: runDevenvTasksBefore('release:devtools-artifact:certify-liveness:no-install'),
              },
              {
                uses: 'actions/upload-artifact@v4',
                if: '${{ !cancelled() }}',
                with: {
                  name: `devtools-certification-${suffix}`,
                  path: 'tests/integration/playwright-report/\ntests/integration/test-results/devtools/',
                  'if-no-files-found': 'ignore',
                },
              },
            ]
          : []),
        {
          name: 'Pack DevTools without publishing',
          run: runDevenvTasksBefore('release:devtools-artifact:pack:no-install'),
          env: { LIVESTORE_DEVTOOLS_OUT_DIR: '${{ runner.temp }}/devtools-repack' },
        },
        {
          name: 'Stage and describe release artifact',
          env: { SOURCE_SHA: releaseHeadSha },
          run: `set -euo pipefail
cp "$RUNNER_TEMP/devtools-repack/livestore-devtools-vite-$LIVESTORE_RELEASE_VERSION.tgz" "$RELEASE_ARTIFACT_DIR/"
for file in "$RUNNER_TEMP/devtools-repack"/livestore-devtools-chrome-*.zip; do
  if [ -f "$file" ]; then cp "$file" "$RELEASE_ARTIFACT_DIR/"; fi
done
${stable === true ? 'cp release/release-notes.md "$RELEASE_ARTIFACT_DIR/release-notes.md"' : ''}
node .github/scripts/release-artifact.mjs create --artifact-dir "$RELEASE_ARTIFACT_DIR" --source-sha "$SOURCE_SHA" --version "$LIVESTORE_RELEASE_VERSION" --npm-tag "$LIVESTORE_NPM_TAG" --topology ${releaseTopologyPath}`,
        },
        {
          uses: 'actions/upload-artifact@v4',
          with: {
            name: `npm-release-${suffix}`,
            path: '${{ runner.temp }}/release-artifact/',
            'if-no-files-found': 'error',
            'retention-days': 14,
          },
        },
        ...(stable === false
          ? [
              {
                name: 'Upload DevTools Chrome snapshot artifact',
                uses: 'actions/upload-artifact@v4',
                with: {
                  name: `livestore-devtools-chrome-0.0.0-snapshot-${releaseHeadSha}`,
                  path: `\${{ runner.temp }}/release-artifact/livestore-devtools-chrome-0.0.0-snapshot-${releaseHeadSha}.zip`,
                  'if-no-files-found': 'error',
                  'retention-days': 14,
                },
              },
            ]
          : []),
      ],
    },
    [validate]: {
      needs: [prepare],
      'runs-on': 'ubuntu-24.04',
      permissions: { contents: 'read' },
      defaults: bashShellDefaults,
      outputs: { manifest_sha512: '${{ steps.validate.outputs.manifest_sha512 }}' },
      steps: [
        {
          uses: 'actions/checkout@v4',
          with: {
            ref: releaseHeadSha,
            'persist-credentials': false,
            'sparse-checkout': `.github/scripts\n${releaseTopologyPath}\nrelease/release-plan.json`,
            'sparse-checkout-cone-mode': false,
          },
        },
        { uses: 'actions/setup-node@v4', with: { 'node-version': '24' } },
        download,
        {
          name: 'Validate exact packages and packed bytes',
          id: 'validate',
          env: { SOURCE_SHA: releaseHeadSha },
          run: `set -euo pipefail
${selectExpectedMetadata}
node .github/scripts/release-artifact.mjs validate --artifact-dir "$RUNNER_TEMP/release-artifact" --source-sha "$SOURCE_SHA" --version "$version" --npm-tag "$npm_tag" --topology ${releaseTopologyPath}
echo "manifest_sha512=$(openssl dgst -sha512 -binary "$RUNNER_TEMP/release-artifact/manifest.json" | openssl base64 -A)" >> "$GITHUB_OUTPUT"`,
        },
      ],
    },
    [publish]: {
      needs: [prepare, validate],
      'runs-on': 'ubuntu-24.04',
      environment: 'npm-publish',
      permissions: { contents: 'read', 'id-token': 'write' },
      defaults: bashShellDefaults,
      steps: [
        { uses: 'actions/setup-node@v4', with: { 'node-version': '24' } },
        download,
        {
          name: 'Verify bytes and publish without build code',
          env: {
            ARTIFACT_DIR: '${{ runner.temp }}/release-artifact',
            MANIFEST_SHA512: output(validate, 'manifest_sha512'),
          },
          run: publishShell,
        },
      ],
    },
    ...(stable === true
      ? {
          'finalize-release': {
            needs: [prepare, validate, publish],
            'runs-on': 'ubuntu-24.04',
            permissions: { contents: 'write' },
            defaults: bashShellDefaults,
            steps: [
              download,
              {
                name: 'Finalize release at the explicit candidate SHA',
                env: {
                  GH_TOKEN: '${{ github.token }}',
                  SOURCE_SHA: releaseHeadSha,
                  MANIFEST_SHA512: output(validate, 'manifest_sha512'),
                },
                run: `set -euo pipefail
actual="$(openssl dgst -sha512 -binary "$RUNNER_TEMP/release-artifact/manifest.json" | openssl base64 -A)"
test "$actual" = "$MANIFEST_SHA512"
VERSION="$(jq -er '.version' "$RUNNER_TEMP/release-artifact/manifest.json")"
tag="v$VERSION"
if gh api "repos/$GITHUB_REPOSITORY/git/ref/tags/$tag" > "$RUNNER_TEMP/release-ref.json" 2>"$RUNNER_TEMP/release-ref-error"; then
  test "$(jq -r '.object.type' "$RUNNER_TEMP/release-ref.json")" = commit
  test "$(jq -r '.object.sha' "$RUNNER_TEMP/release-ref.json")" = "$SOURCE_SHA" || { echo "Release tag points to another SHA" >&2; exit 1; }
else
  grep -q 'HTTP 404' "$RUNNER_TEMP/release-ref-error" || { cat "$RUNNER_TEMP/release-ref-error" >&2; exit 1; }
  gh api "repos/$GITHUB_REPOSITORY/git/refs" -f ref="refs/tags/$tag" -f sha="$SOURCE_SHA"
fi
notes="$RUNNER_TEMP/release-artifact/release-notes.md"
if gh release view "$tag" --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1; then
  gh release edit "$tag" --repo "$GITHUB_REPOSITORY" --notes-file "$notes"
else
  args=()
  if [[ "$VERSION" == *-* ]]; then args+=(--prerelease); fi
  gh release create "$tag" --repo "$GITHUB_REPOSITORY" --verify-tag --target "$SOURCE_SHA" --title "$tag" --notes-file "$notes" "\${args[@]}"
fi
for file in "$RUNNER_TEMP/release-artifact"/livestore-devtools-chrome-*.zip; do
  if [ -f "$file" ]; then gh release upload "$tag" "$file" --repo "$GITHUB_REPOSITORY" --clobber; fi
done`,
              },
            ],
          },
        }
      : {}),
  }
}
