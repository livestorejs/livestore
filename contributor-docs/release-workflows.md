# Release Workflows

LiveStore releases are CI-driven and represented as reviewable repository
state. Local release commands are still useful for dry-runs and emergency
operations, but the preferred stable release path is to let GitHub Actions open
and validate a release-plan PR.

## Release kinds

### Snapshot releases

Snapshot releases publish the public `@livestore/*` package set with a
`0.0.0-snapshot-<git-sha>` version and the npm `snapshot` dist-tag.

CI runs the snapshot workflow for normal pull-request validation. The snapshot
package graph rewrites internal `@livestore/*` dependencies to the exact
snapshot version so the published packages can be installed outside the
monorepo.

Maintainers can dry-run the snapshot publisher locally:

```bash
CI=1 mono release snapshot --dry-run --yes
```

To dry-run a snapshot for a specific commit:

```bash
CI=1 mono release snapshot --git-sha=<git-sha> --dry-run --yes
```

Local snapshot publishing should be rare; prefer the CI snapshot workflow so npm
provenance and package identity match the reviewed commit.

### Stable release groups

Stable releases use `release/release-plan.json` as the source of truth. The
plan records the LiveStore release-group version and npm dist-tag:

```json
{
  "schemaVersion": 1,
  "version": "0.4.0",
  "npmTag": "latest"
}
```

The preferred flow is:

1. Run the `Release` workflow manually from the `dev` branch with the target
   version and npm tag.
2. Let the workflow open or update `automation/release-<version>` with the
   generated `release/release-plan.json`.
3. Review the release-plan PR and wait for CI to pass.
4. Merge the release-plan PR into `dev`.
5. Let the push-triggered `Release` workflow publish the release group.

The release-plan PR validates the exact work that will run after merge:

- `release:stable:dryrun` dry-runs npm publishing for the LiveStore package set.
- `release:devtools-artifact:repack-dryrun:no-install` verifies and repacks the
  public DevTools artifact for the same LiveStore version without publishing it.

After merge to `dev`, the push-triggered workflow runs:

- `release:stable:publish`
- `release:devtools-artifact:publish:no-install`

## Local stable release checks

Use the local tasks to reproduce the CI release checks before pushing release
tooling changes.

Create a release plan:

```bash
LIVESTORE_RELEASE_VERSION=0.4.0 LIVESTORE_NPM_TAG=latest dt release:plan
```

Dry-run the package publish:

```bash
CI=1 dt release:stable:dryrun
```

Dry-run the DevTools artifact repack for the planned version:

```bash
CI=1 LIVESTORE_RELEASE_VERSION=0.4.0 dt release:devtools-artifact:repack-dryrun
```

Use `release:devtools-artifact:repack-dryrun:no-install` only when setup has
already run in the same CI job or local shell.

## DevTools artifact contract

LiveStore consumes DevTools through a checked-in public artifact manifest at
`release/devtools-artifact.json`. The manifest points at versioned public
artifact files and may include the expected tarball SHA-256.

The LiveStore release workflow only consumes those published artifacts. It must
not require, copy, log, or publish non-public DevTools source. Artifact
verification checks the metadata, tarball hash and integrity, package shape, and
text-like files for common secret or machine-local patterns before repacking.

The repacked package writes `dist/release-metadata.json` with both identities:

- `devtoolsArtifact.devtoolsVersion`
- `devtoolsArtifact.devtoolsBuildId`
- `livestoreVersion`

Use those fields to correlate a published LiveStore package with the exact
public DevTools artifact when investigating failures.

## Updating the DevTools artifact manifest

When a new public DevTools artifact should be included in the next LiveStore
release:

1. Update `release/devtools-artifact.json` to the new public metadata and
   tarball URLs.
2. Include the tarball SHA-256 when available.
3. Run `CI=1 dt release:devtools-artifact:verify`.
4. Open a PR with only the manifest change unless release tooling also changed.

The release PR will then dry-run the repack using that manifest. When the
release-plan PR merges to `dev`, the publish job repackages and publishes the
artifact as `@livestore/devtools-vite@<livestore-version>`.

## Safety rules

- Do not add non-public DevTools source, internal paths, credentials, or local
  machine details to this repository.
- Do not paste secrets into release plans, PR descriptions, workflow inputs, or
  artifact metadata.
- Treat `release/release-plan.json` as reviewable release intent, not a scratch
  file.
- Regenerate generated workflow files through Genie; do not edit generated
  `.github/workflows/*.yml` files directly.
- Prefer CI-created release-plan PRs for stable releases so dry-run validation
  and publish behavior stay aligned.
