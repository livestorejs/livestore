import { bashShellDefaults, defaultActionlintConfig, githubWorkflow, livestoreSetupSteps } from '../../genie/repo.ts'

export default githubWorkflow({
  name: 'DevTools artifact manifest',
  actionlint: defaultActionlintConfig,

  on: {
    pull_request: {
      paths: [
        '.github/workflows/devtools-artifact.yml',
        '.github/workflows/devtools-artifact.yml.genie.ts',
        'genie/repo.ts',
        'release/devtools-artifact.json',
        'scripts/src/commands/devtools-artifact.ts',
      ],
    },
    repository_dispatch: {
      types: ['devtools-artifact-published'],
    },
    workflow_dispatch: {
      inputs: {
        metadata_url: {
          description: 'Public release-metadata.json URL',
          required: true,
          type: 'string',
        },
        tarball_url: {
          description: 'Public artifact tarball URL',
          required: true,
          type: 'string',
        },
        sha256: {
          description: 'Artifact tarball SHA-256',
          required: true,
          type: 'string',
        },
        chrome_zip_url: {
          description: 'Public Chrome extension ZIP URL',
          required: false,
          type: 'string',
        },
        chrome_zip_sha256: {
          description: 'Chrome extension ZIP SHA-256',
          required: false,
          type: 'string',
        },
        devtools_build_id: {
          description: 'Public DevTools build id',
          required: false,
          type: 'string',
        },
      },
    },
  },

  permissions: {
    contents: 'write',
    'pull-requests': 'write',
  },

  env: {
    CACHIX_AUTH_TOKEN: '${{ secrets.CACHIX_AUTH_TOKEN }}',
    CI: 'true',
    FORCE_SETUP: '1',
    ARTIFACT_METADATA_URL: '${{ github.event.client_payload.artifactMetadataUrl || inputs.metadata_url }}',
    ARTIFACT_TARBALL_URL: '${{ github.event.client_payload.artifactTarballUrl || inputs.tarball_url }}',
    ARTIFACT_SHA256: '${{ github.event.client_payload.sha256 || inputs.sha256 }}',
    ARTIFACT_CHROME_ZIP_URL: '${{ github.event.client_payload.artifactChromeZipUrl || inputs.chrome_zip_url }}',
    ARTIFACT_CHROME_ZIP_SHA256: '${{ github.event.client_payload.chromeZipSha256 || inputs.chrome_zip_sha256 }}',
    DEVTOOLS_BUILD_ID: '${{ github.event.client_payload.devtoolsBuildId || inputs.devtools_build_id }}',
    BASE_BRANCH: '${{ github.event.repository.default_branch }}',
  },

  jobs: {
    'update-manifest-pr': {
      'runs-on': 'ubuntu-latest',
      defaults: bashShellDefaults,
      steps: [
        ...livestoreSetupSteps,
        {
          name: 'Write artifact manifest',
          run: `set -euo pipefail
if [ -z "\${ARTIFACT_METADATA_URL:-}" ] && [ "\${GITHUB_EVENT_NAME:-}" = "pull_request" ]; then
  ARTIFACT_METADATA_URL="$(jq -r '.artifact.metadataUrl' release/devtools-artifact.json)"
  ARTIFACT_TARBALL_URL="$(jq -r '.artifact.tarballUrl' release/devtools-artifact.json)"
  ARTIFACT_SHA256="$(jq -r '.artifact.sha256' release/devtools-artifact.json)"
  ARTIFACT_CHROME_ZIP_URL="$(jq -r '.artifact.chromeZipUrl // ""' release/devtools-artifact.json)"
  ARTIFACT_CHROME_ZIP_SHA256="$(jq -r '.artifact.chromeZipSha256 // ""' release/devtools-artifact.json)"
fi

: "\${ARTIFACT_METADATA_URL:?Missing artifact metadata URL}"
: "\${ARTIFACT_TARBALL_URL:?Missing artifact tarball URL}"
: "\${ARTIFACT_SHA256:?Missing artifact SHA-256}"
if [ -n "\${ARTIFACT_CHROME_ZIP_URL:-}" ] && [ -z "\${ARTIFACT_CHROME_ZIP_SHA256:-}" ]; then
  echo "Missing Chrome ZIP SHA-256"
  exit 1
fi

mkdir -p release
jq -n \\
  --arg metadataUrl "$ARTIFACT_METADATA_URL" \\
  --arg tarballUrl "$ARTIFACT_TARBALL_URL" \\
  --arg sha256 "$ARTIFACT_SHA256" \\
  --arg chromeZipUrl "\${ARTIFACT_CHROME_ZIP_URL:-}" \\
  --arg chromeZipSha256 "\${ARTIFACT_CHROME_ZIP_SHA256:-}" \\
  '{
    schemaVersion: 1,
    artifact: {
      metadataUrl: $metadataUrl,
      tarballUrl: $tarballUrl,
      sha256: $sha256
    }
  }
  | if $chromeZipUrl == "" then .
    else .artifact += {
      chromeZipUrl: $chromeZipUrl,
      chromeZipSha256: $chromeZipSha256
    }
  end' > release/devtools-artifact.json`,
        },
        {
          name: 'Verify artifact manifest',
          run: '$DEVENV_BIN tasks run release:devtools-artifact:verify --mode before --no-tui',
        },
        {
          name: 'Open manifest update PR',
          if: "github.event_name != 'pull_request'",
          env: {
            GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
          },
          run: `set -euo pipefail
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

suffix="\${DEVTOOLS_BUILD_ID:-$(date -u +%Y%m%d%H%M%S)}"
branch="automation/devtools-artifact-\${suffix}"
git checkout -B "$branch"
git add release/devtools-artifact.json

if git diff --cached --quiet; then
  echo "Artifact manifest already current."
  exit 0
fi

git commit -m "Update LiveStore DevTools artifact manifest"
git push --force-with-lease origin "$branch"

title="Update LiveStore DevTools artifact manifest"
body="$(cat <<'BODY'
Updates the public DevTools artifact manifest from a sanitized artifact release.

This PR only changes public artifact URLs and checksums. The workflow verifies the tarball before opening the PR.
BODY
)"

if gh pr view "$branch" --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1; then
  gh pr edit "$branch" --repo "$GITHUB_REPOSITORY" --title "$title" --body "$body" --base "$BASE_BRANCH"
else
  gh pr create --repo "$GITHUB_REPOSITORY" --base "$BASE_BRANCH" --head "$branch" --title "$title" --body "$body"
fi`,
        },
      ],
    },
  },
})
