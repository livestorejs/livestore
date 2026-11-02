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

Pull-request CI packs an immutable exact-head candidate for repository-owned and
fork PRs. Repository-owned candidates publish after the ordinary current-head
approval. Fork candidates publish while a maintainer-managed
`ci:publish-snapshot` label is present. The label trusts control of that PR's
head repository and branch, including later commits while it remains present;
remove it to stop publication that has not started.

The trusted workflow resolves fork producers by exact head repository, branch,
and SHA because GitHub may omit fork PR associations. It rechecks the open PR,
unchanged head, and live label immediately before npm OIDC publication. A fork
PR whose earlier CI run predates this behavior needs a new PR update before a
candidate exists; applying the label does not backfill a skipped pack job.

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

Alongside `release/release-plan.json`, the release PR generator extracts
reviewable `CHANGELOG.md` content into `release/release-notes.md` via the
`release:notes:extract` task (which calls
`mono release extract-release-notes`). Stable releases use the exact promoted
version section. Prereleases use `Unreleased`, because they intentionally
preserve pending Changesets and therefore do not promote that content to an
exact version heading. The extracted file is committed to the release-plan PR
so reviewers see exactly what will land on the GitHub Release page.

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

### npm visibility and staged-publish recovery

Audience: release maintainers who have the original release run and its exact
commit, version, and npm tag. These steps apply to both the core package
publisher and the repacked `@livestore/devtools-vite` publisher.

A successful npm upload is not proof that a version is publicly installable.
Staged versions reserve the same package/version identity as published
versions, but are not publicly available until approved. A retry can therefore
receive npm `E409` / `409 Conflict` with `Cannot publish over previously staged
version` while `npm view <package>@<version> version --json` still cannot find
the version. Treat that specific conflict as pending visibility, not as a
successful release or a reason to change the release version. Other publish
errors are not evidence of staging.

Both publishers make an initial public visibility check followed by up to 60
retries at five-second intervals, logging each missing-package attempt. This is
a bounded wait of roughly five minutes plus registry request time, not an
unbounded approval wait. Already-visible versions are skipped on reruns.
If any required version is still missing when the attempts are exhausted,
verification fails and reports the missing package/version and approval
instructions. Do not mark the release green or advance production promotion
while verification is failing. Missing visibility alone does not prove that
a maintainer-approvable stage exists.

#### Find and approve the exact staged version

Use a trusted local terminal, npm CLI 11.15.0 or newer, Node 22.14.0 or newer,
and a maintainer account with package publish access and 2FA enabled.
For each missing package, substitute its package name (without `@<version>`)
and inspect the returned records for the exact intended version and tag:

```bash
npm stage list <package> --json
npm stage view <stage-id> --json
```

Check the record's `id`, `packageName`, `version`, `tag`, `status`, actor, and
`shasum` against the reviewed release and original run. If needed, use
`npm stage download <stage-id>` to inspect the tarball. Do not approve an
unrelated candidate merely because its package name matches.

Once the expected candidate has completed npm's malware scan, a human
maintainer approves that stage and completes the interactive 2FA challenge:

```bash
npm stage approve <stage-id>
```

The npmjs.com package **Staged Packages** tab also supports review and approval
with 2FA. Approval publishes the staged version. Staging, listing, and viewing
do not require a 2FA challenge, but approval does. Each staged package version
needs approval, including each affected package in a release group. Neither
the release workflow nor an agent should auto-approve or handle the
maintainer's OTP.

After approval, rerun the original failed release workflow/job for the same
commit, version, and npm tag. Do not generate a new release plan, bump the
version, or rebuild a different candidate to evade the conflict. The publishers
skip visible versions and finish the remaining publication/verification work.
If the stage list is empty, the candidate differs, or the approved version
remains unavailable, retain the failed state and investigate npm scanning,
registry/authentication, and the original publish logs. An `E409` can also
occur without an approvable stage, as reported in
[npm/cli#9889](https://github.com/npm/cli/issues/9889).

#### Trusted publishing: staging is not an OIDC requirement

OIDC authenticates the CI workflow; it does not itself require human approval
for every release. npm's current trusted-publisher configuration always allows
`npm stage publish`, while direct `npm publish` and dist-tag management are
independent allowed actions. Configurations created after September 3, 2026
default to staging, with direct publishing opt-in. Older configurations retain
their documented existing permissions rather than being silently migrated.
Multiple matching configurations are additive, not restrictive.

For intentionally unattended direct publication, a maintainer must ensure that
the matching package **Settings → Trusted publishing → Allowed actions**
permits `npm publish` for the intended repository, workflow, and environment.
Do not broaden unrelated configurations or introduce a long-lived token to
bypass an approval gate. Changing allowed actions does not approve or clear an
already-staged version. Direct OIDC publishing remains the existing code path
and needs no per-release npm 2FA approval when authorized; choosing staging
means human 2FA approval for every staged package version.

The inspected npm CLI 11.21.0 implementation does not automatically convert a
failed direct publish into a stage: `npm publish` uses a package `PUT`, while
`npm stage publish` uses `POST /-/stage/package/<escaped-package-name>` and
returns `stageId` (also included in its JSON output). The OIDC helper exchanges
credentials, not publish mode. Do not infer an automatic CLI stage fallback
from an upload's exit status or a later staged-version conflict.

For exact stage detection, the CLI's authenticated `npm stage list <package>
--json` paginates `GET /-/stage?package=<package>&page=0&perPage=100`, collecting
`items` until `total` is reached. Match `packageName` and `version`, then use
the record's `id` with `GET /-/stage/<stage-id>` (`npm stage view`). Approval
uses `POST /-/stage/<stage-id>/approve` with the CLI's interactive 2FA handling.
These are implementation references, not a substitute for public visibility
verification or a reason to add approval to CI.

Primary references:

- [npm staged publishing](https://docs.npmjs.com/staged-publishing/) and
  [`npm stage` CLI commands](https://docs.npmjs.com/cli/v11/commands/npm-stage).
- [Trusted-publisher allowed actions and configuration defaults](https://docs.npmjs.com/trusted-publishers/).
- [Staged publishing announcement (May 22, 2026)](https://github.blog/changelog/2026-05-22-staged-publishing-and-new-install-time-controls-for-npm/)
  and [multiple publishers, opt-in direct publish, and scan-gated approval (September 3, 2026)](https://github.blog/changelog/2026-09-03-multiple-trusted-publishing-configurations-for-npm/).
- npm CLI 11.21.0 implementation:
  [publish mode and stage output](https://github.com/npm/cli/blob/v11.21.0/lib/commands/publish.js),
  [registry publish routes](https://github.com/npm/cli/blob/v11.21.0/workspaces/libnpmpublish/lib/publish.js),
  [OIDC exchange](https://github.com/npm/cli/blob/v11.21.0/lib/utils/oidc.js),
  [stage listing](https://github.com/npm/cli/blob/v11.21.0/lib/commands/stage/list.js),
  [stage details](https://github.com/npm/cli/blob/v11.21.0/lib/commands/stage/view.js),
  and [2FA approval](https://github.com/npm/cli/blob/v11.21.0/lib/commands/stage/approve.js).

### Promote stable production surfaces

Publishing packages and artifacts does not deploy production docs, examples, or
search. For a successful `latest` release, the maintainer completes this separate
reviewed promotion:

1. Record the exact commit published by the successful `Release` run and its
   release version. Do not use a moving `main` head.
2. Open a PR targeting `docs/stable` from a branch at that release commit.
   Review the complete diff against `docs/stable`, retain any stable-only docs
   fixes that are still applicable, and confirm `release/version.json` and the
   package graph identify the published stable version. Wait for CI and required
   approvals, then merge the PR. Do not force-push or reset `docs/stable`.
   Promotion PR CI validates the existing stable plan rather than synthesizing
   an unpublished version or rehearsing publication: every topology package
   must exist at the plan version with npm `latest` pointing to it, and the
   published `v<version>` tag's commit must be an ancestor of the exact PR head.
   PRs against `main` retain the unpublished-version dry run.
3. Record the merged `docs/stable` SHA. Keep the branch unchanged throughout
   the following dispatches and confirm each run's head SHA equals it:

   ```bash
   gh workflow run deploy-prod.yml --ref docs/stable -f target=docs
   ```

4. Wait for the docs build/deploy, verification, and CDN purge to succeed. Then
   deploy examples from the same branch and SHA:

   ```bash
   gh workflow run deploy-prod.yml --ref docs/stable -f target=examples
   ```

5. After successful docs deployment, sync production search from that same SHA:

   ```bash
   gh workflow run deploy-prod.yml --ref docs/stable -f target=search
   ```

Verify the public docs version, example URLs, and production search results
before declaring the release complete. `target=all` is also supported from
`docs/stable`; its search job waits for a successful docs job. Separate target
dispatches make each promotion/recovery stage explicit.

The ref guard and combined-target search ordering are provided by the workflow
files on the dispatch ref. They take effect on `docs/stable` only once the
promotion PR carries these workflow files onto that branch.

The branch was established from the deployed stable baseline in
[#1637](https://github.com/livestorejs/livestore/pull/1637), allowing reviewed
documentation backports without publishing unrelated development content.
Stable docs-only updates use the same PR and deploy/search sequence; examples
need redeployment only when their source changes. Prereleases and snapshots
never advance `docs/stable` or deploy production surfaces.

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

| Phase          | Task                                  | Purpose                                                                                             |
| -------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `build-deploy` | `docs:deploy:prod:phase:build-deploy` | `mono docs deploy --prod --step=upload` (runs `netlify deploy --build`), writes `deploy-state.json` |
| `verify`       | `docs:deploy:prod:phase:verify`       | `mono docs deploy --prod --step=verify`, posts job summary                                          |
| `purge`        | `docs:deploy:prod:phase:purge`        | `mono docs deploy --prod --step=purge`, purges Netlify CDN                                          |

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
gh workflow run deploy-prod.yml --ref docs/stable -f target=docs    # or examples / search / all
```

This workflow is `workflow_dispatch`-only and rejects refs other than
`docs/stable` for every production target. Retry from the reviewed stable SHA;
never re-run npm publication merely to repair docs. After a successful docs
retry, sync search from the same unchanged branch so its index matches the site.

CI snapshot publishing still republishes the public DevTools npm package for
the exact snapshot version. Snapshot Chrome ZIPs are retained as workflow
artifacts for short-term debugging; they are not published as GitHub Releases.
GitHub Releases are reserved for dev and stable release versions that users may
need to download directly.

Normal CI deploys docs/examples to the dev surfaces. Production docs, examples,
and search are updated only by explicit dispatches from reviewed `docs/stable`
state, so regular `main` integration cannot update the public latest surfaces.

## Local stable release checks

Use the local tasks to reproduce the CI release checks before pushing release
tooling changes.

Create a release plan:

```bash
LIVESTORE_NPM_TAG=latest devenv tasks run release:changeset:version
```

This is the local equivalent of the workflow-dispatch release PR generator.

Dry-run the package publish:

```bash
CI=1 devenv tasks run release:stable:dryrun
```

Dry-run the DevTools artifact repack for the planned version:

```bash
CI=1 LIVESTORE_RELEASE_VERSION=0.4.0 devenv tasks run release:devtools-artifact:repack-dryrun
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
3. Run `CI=1 devenv tasks run release:devtools-artifact:verify`.
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
