# Release Workflows

LiveStore releases are CI-driven and represented as reviewable repository
state. Local release commands are still useful for dry-runs and emergency
operations, but the preferred stable release path is to let GitHub Actions open
and validate a release-plan PR.

## Release intent

Changesets are the release-intent ledger for LiveStore pull requests.
The public `@livestore/*` packages are configured as a fixed Changesets group,
so any accepted changeset bumps the whole LiveStore release group together.

`CHANGELOG.md` remains the curated user-facing release narrative. Do not let
generated release notes replace it. Maintainers fold PR-level changeset
information into the handcrafted changelog structure before cutting a stable
release.

Every PR must include one of:

- A regular `.changeset/*.md` file for release-impacting changes.
- An empty changeset for changes that do not need release notes.

```bash
pnpm exec changeset
pnpm exec changeset add --empty
```

The baseline `.changeset/livestore-0-4-0-baseline.md` mirrors the existing
handcrafted `CHANGELOG.md` 0.4.0 unreleased section. Keep both in sync until the
supervised 0.4.0 release consumes that baseline.

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

Stable releases use Changesets to calculate the next fixed-group version, then
write `release/release-plan.json` as the publish intent. The plan records the
LiveStore release-group version and npm dist-tag:

```json
{
  "schemaVersion": 1,
  "version": "0.4.0",
  "npmTag": "latest"
}
```

The preferred flow is:

1. Ensure pending changesets and `CHANGELOG.md` agree on the intended release
   contents.
2. Run the `Release` workflow manually from `main` with the intended npm tag.
   The workflow consumes changesets, syncs `release/version.json`, regenerates
   Genie-managed manifests, refreshes the lockfile, and opens or updates the
   release-plan PR.
3. Review the release-plan PR and wait for CI to pass.
4. Merge the release-plan PR into `main`.
5. Let the push-triggered `Release` workflow publish the release group.

For `dev` releases, the release PR generator derives the next prerelease from
the current npm `dev` dist-tag for `@livestore/common`. For example, if the
dist-tag points at `0.4.0-dev.23`, the next generated dev release is
`0.4.0-dev.24`.

After Genie regenerates the fixed public package versions, the release PR
generator also syncs standalone examples and other non-workspace consumers to
the exact release version. This keeps `pnpm install --lockfile-only` validating
the same package graph that the release will publish.

Release plans are validated against the npm dist-tag before dry-run or publish:

- `latest` only accepts stable versions such as `0.4.0`.
- `dev` only accepts dev prereleases such as `0.4.0-dev.24`.
- Other non-`latest` tags only accept prerelease versions.
- `snapshot` is reserved for CI snapshot publishing and cannot be used through
  `release.yml`.

The release-plan PR validates the exact work that will run after merge:

- `release:stable:dryrun` dry-runs npm publishing for the LiveStore package set.
- `release:devtools-artifact:repack-dryrun:no-install` verifies and repacks the
  public DevTools artifact for the same LiveStore version without publishing it.

After merge to `main`, the push-triggered workflow runs:

- `release:stable:publish`
- `release:devtools-artifact:publish:no-install`
- For stable `latest` releases only: `docs:deploy:prod`,
  `examples:deploy:prod`, and the production docs search sync.

Normal CI deploys docs/examples to the dev surfaces. Production docs, examples,
and search are only updated by an explicit stable release publish so regular
`main` integration work cannot accidentally update the public latest surfaces.

## Local stable release checks

Use the local tasks to reproduce the CI release checks before pushing release
tooling changes.

Create a release plan:

```bash
LIVESTORE_NPM_TAG=latest dt release:changeset:version
```

This is the local equivalent of the workflow-dispatch release PR generator.

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
artifact files and includes the expected tarball SHA-256.

Public DevTools artifact releases are identified by the artifact build id, for
example `devtools-artifact-dt-20260505-398c5feb`. The DevTools implementation
version may appear inside `release-metadata.json` for traceability, but it is
not the public artifact release identity and it does not decide the LiveStore
package version.

The LiveStore release workflow only consumes those published artifacts. It must
not require, copy, log, or publish non-public DevTools source. Artifact
verification checks the metadata, tarball hash and integrity, package shape, and
text-like files for common secret or machine-local patterns before repacking.

The repacked package writes `dist/release-metadata.json` with both identities:

- `devtoolsArtifact.devtoolsVersion`
- `devtoolsArtifact.devtoolsBuildId`
- `livestoreVersion`

Use `devtoolsArtifact.devtoolsBuildId` to correlate a published LiveStore
package with the exact public DevTools artifact when investigating failures.
Use `livestoreVersion` to correlate the republished npm package and GitHub
Chrome ZIP asset with the LiveStore release group or snapshot.

## Updating the DevTools artifact manifest

When a new public DevTools artifact should be included in the next LiveStore
release:

1. Update `release/devtools-artifact.json` to the new public metadata and
   tarball URLs.
2. Include the tarball SHA-256 when available.
3. Run `CI=1 dt release:devtools-artifact:verify`.
4. Open a PR with only the manifest change unless release tooling also changed.

The release PR will then dry-run the repack using that manifest. When the
release-plan PR merges to `main`, the publish job repackages and publishes the
artifact as `@livestore/devtools-vite@<livestore-version>`.

## Safety rules

- `main` is the only canonical release branch. Do not cut releases from `dev`.
- Do not use `--prod` docs/examples deploys for snapshots or prereleases. The
  deploy commands reject non-stable LiveStore versions.
- Do not add non-public DevTools source, internal paths, credentials, or local
  machine details to this repository.
- Do not paste secrets into release plans, PR descriptions, workflow inputs, or
  artifact metadata.
- Treat `release/release-plan.json` as reviewable release intent, not a scratch
  file.
- Treat `release/version.json` as the Genie source of truth for the checked-in
  package version. Snapshot and dry-run publishes may still override the version
  with `LIVESTORE_RELEASE_VERSION`.
- Keep checked-in release-plan PRs installable before publish. The stable
  `@livestore/devtools-vite` artifact is injected by the dry-run/publish tasks
  via `LIVESTORE_RELEASE_VERSION`; it is not required to exist before the PR is
  validated.
- Regenerate generated workflow files through Genie; do not edit generated
  `.github/workflows/*.yml` files directly.
- Do not publish patch, minor, or major releases while testing this Changesets
  integration. Use snapshots and non-`latest` prerelease tags until the final
  supervised release.
- Release-sensitive files are code-owned and should be reviewed by a maintainer:
  `.github/`, `.changeset/`, `release/`, and release command scripts.
