# Release Workflows

> Companion runbook of [02-release](./spec.md) — operational procedure only;
> the normative contract lives in this node's requirements/spec.

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

Every PR that touches files in the public LiveStore package graph must include
one of:

- A regular `.changeset/*.md` file for release-impacting changes.
- An empty changeset for changes that do not need release notes.

```bash
pnpm exec changeset
pnpm exec changeset add --empty
```

The PR changeset check derives that package graph from the public `@livestore/*`
workspace packages. Infrastructure, documentation, generated workflow, and
release-control-plane changes that do not touch those package directories do
not need an empty changeset.

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

Dev and other prerelease release PRs do not consume pending changesets. The
generator temporarily runs Changesets to calculate the fixed-group package
version, then restores pending `.changeset/*.md` files before opening the PR.
This keeps prereleases as publish rehearsals and reserves release-intent
consumption for the supervised stable `latest` release.

After Genie regenerates the fixed public package versions, the release PR
generator also syncs standalone examples and other non-workspace consumers to
the exact release version. This keeps `pnpm install --lockfile-only` validating
the same package graph that the release will publish.

The release PR generator also updates the LiveStore-owned DevTools artifact
certification in `release/devtools-artifact.json` to the generated release
version and stages that manifest in the release PR. This keeps the checked-in
release data self-contained: the DevTools artifact identity remains the
artifact build id, while the LiveStore package version is assigned by release
automation and then validated by CI before auto-merge.

### Release notes artifact

Alongside `release/release-plan.json`, the release PR generator extracts the
current version's `CHANGELOG.md` section into `release/release-notes.md` via
the `release:notes:extract` task (which calls
`mono release extract-release-notes`). The extracted file is committed to the
release-plan PR so reviewers see exactly what will land on the GitHub Release
page.

The DevTools artifact publish step then uses that file when it creates or
updates the GitHub Release tag:

- On `gh release create`, it passes `--notes-file release/release-notes.md`
  instead of the legacy hardcoded `Release <version>` body.
- On subsequent reruns (the release already exists), it also calls
  `gh release edit --notes-file release/release-notes.md` so a corrected
  `CHANGELOG.md` section actually lands on the GitHub Release page.

If `release/release-notes.md` is missing at publish time, the publish step
falls back to the legacy `Release <version>` body and logs a warning. To
refresh it locally for a planned release:

```bash
mono release extract-release-notes
```

This reads the version from `release/release-plan.json` and writes
`release/release-notes.md`.

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
- For stable `latest` releases only: docs prod deploy (phase-split, see below),
  `examples:deploy:prod`, and the production docs search sync.

### Prod docs deploy phase split

The prod docs deploy was previously a single `mono docs deploy --prod --build
--purge-cdn` invocation. It hung reproducibly for the 0.4.0 release because the
tldraw diagram renderer (via `@kitschpatrol/tldraw-cli` + Puppeteer) can leave
an orphan Chromium child that keeps the parent Bun/Node process alive
indefinitely. See [#1279](https://github.com/livestorejs/livestore/issues/1279)
for the original incident.

The deploy is split into three phases, each run as a separate
`docs:deploy:prod:phase:*` Nix task. Every phase wraps its mono invocation with
`timeout --signal=TERM --kill-after=2m N`, so the OS reaps the entire process
group (including orphan Chromium) regardless of what the Effect-level handler
is doing. A background heartbeat writes `[docs-prod-heartbeat] <iso8601>
<pgrep-output>` every 30–60 s to keep CI logs anchored to wall-clock and to
make hangs greppable in retrospect.

Under "Option A" the former `snippets`/`diagrams`/`astro`/`upload` phases collapse
into a single `build-deploy` phase: `netlify deploy --build` runs the full
`@netlify/build` pipeline (framework build, which auto-builds snippets/diagrams,
plus serverless + edge bundling) and the upload in one bounded step. The build
still spawns Chromium for mermaid, so the `timeout(1)` wrapper around this one
phase remains the orphan-Chromium backstop.

| Phase          | Task                                  | Purpose                                                                          |
| -------------- | ------------------------------------- | -------------------------------------------------------------------------------- |
| `build-deploy` | `docs:deploy:prod:phase:build-deploy` | `mono docs deploy --prod --step=upload` (runs `netlify deploy --build`), writes `deploy-state.json` |
| `verify`       | `docs:deploy:prod:phase:verify`       | `mono docs deploy --prod --step=verify`, posts job summary                       |
| `purge`        | `docs:deploy:prod:phase:purge`        | `mono docs deploy --prod --step=purge`, purges Netlify CDN                       |

The `build-deploy` phase writes Netlify identifiers to `tmp/ci-docs-prod/deploy-state.json`
so `verify` and `purge` can run as independent processes (and independent Actions
steps / jobs) without re-uploading the build. The state file plus per-phase logs
are uploaded as a `docs-prod-deploy-logs-*` artifact on every run for retrospective
debugging.

The deploy handler emits OpenTelemetry spans (`docs.deploy.upload`,
`docs.deploy.verify.markdown-negotiation`, `netlify.deploy`, `netlify.purge-cdn`)
under the shared `OTEL_EXPORTER_OTLP_ENDPOINT` already wired in `genie/repo.ts`'s
`otelSetupStep`.

### Operator recovery: re-running a single deploy target

When the publish-release run has succeeded the npm publish and DevTools artifact
stages but the docs / examples / search deploy fails or times out, re-dispatch
just the failing target via `.github/workflows/deploy-prod.yml` instead of
re-running the entire publish chain:

```bash
gh workflow run deploy-prod.yml -f target=docs    # or examples / search / all
```

This workflow is `workflow_dispatch`-only. The forward path during a release
still runs inline in `release.yml#publish-release` so dev-tag and stable
releases share the same per-phase task definitions.

CI snapshot publishing still republishes the public DevTools npm package for
the exact snapshot version. Snapshot Chrome ZIPs are retained as workflow
artifacts for short-term debugging; they are not published as GitHub Releases.
GitHub Releases are reserved for dev and stable release versions that users may
need to download directly.

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

New artifact metadata should also include a monotonically increasing
`artifactVersion`, a `devtoolsProtocolVersion`, `builtAt`, and `sourceRevision`.
`artifactVersion` orders DevTools artifact lineage. `devtoolsProtocolVersion`
is the runtime compatibility contract between the app and DevTools. LiveStore
package versions may differ from the source artifact version. For dev and
stable release-channel packages, shipping compatibility is decided by the
LiveStore-owned certification entry in `release/devtools-artifact.json`, not by
artifact-owned package versions or broad self-declared compatibility ranges.

The LiveStore release workflow only consumes those published artifacts. It must
not require, copy, log, or publish non-public DevTools source. Artifact
verification checks the metadata, tarball hash and integrity, package shape, and
text-like files for common secret or machine-local patterns before repacking.
Repack validation also rejects artifacts with unsupported DevTools protocol
versions. For dev and stable release versions, repack also requires a
schemaVersion 2 manifest certification with `status: passed`, the exact
LiveStore version, exact DevTools build id, protocol version, and the e2e
scenarios that passed. The release PR generator rewrites only the
`livestoreVersion` and evidence text for an already-passed certification so the
manifest matches the generated release plan; it does not change the DevTools
artifact build, protocol, or scenario list. CI snapshot packages are per-commit
artifacts and cannot be pre-certified in the checked-in manifest; they still
pass through artifact integrity, package-shape, secret-scan, and protocol
validation.

The repacked package writes `dist/release-metadata.json` with both identities:

- `devtoolsArtifact.devtoolsVersion`
- `devtoolsArtifact.devtoolsBuildId`
- `devtoolsArtifact.artifactVersion` when provided by the artifact producer
- `devtoolsArtifact.devtoolsProtocolVersion`
- `livestoreVersion`
- `livestoreCertification`

Use `devtoolsArtifact.devtoolsBuildId` to correlate a published LiveStore
package with the exact public DevTools artifact when investigating failures.
Use `livestoreVersion` to correlate the republished npm package and GitHub
Chrome ZIP asset with the LiveStore release group or snapshot.
Do not use `devtoolsArtifact.devtoolsVersion` for compatibility or ordering.

## Updating the DevTools artifact manifest

When a new public DevTools artifact should be included in the next LiveStore
release:

1. Update `release/devtools-artifact.json` to the new public metadata and
   tarball URLs.
2. Include the tarball SHA-256 when available.
3. Run `CI=1 dt release:devtools-artifact:verify`.
4. Run the release e2e scenarios against the current LiveStore branch and
   DevTools build id.
5. Add the schemaVersion 2 certification entry only after e2e passes.
6. Open a PR with only the manifest and certification change unless release
   tooling also changed.

The release PR generator will assign that passed certification to the generated
release version and dry-run the repack using the resulting manifest. When the
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
