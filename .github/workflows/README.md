# GitHub Workflows

## `ci.yml`

Primary validation workflow for pull requests, `main` pushes, and manual
workflow-dispatch runs. `main` is the canonical default and release branch.

It runs the normal repository quality gates: linting, Changesets release-intent
checks, TypeScript builds, unit tests, integration tests, Playwright tests,
performance tests, docs/examples builds, and dev docs/examples deploys.

Jobs install the repository's pinned Vite+ toolchain through
`voidzero-dev/setup-vp`, which also caches pnpm's package data. CI gates run as
named `vp run ci:*` tasks. The deterministic lint and type-check task caches are
transported between equivalent GitHub Actions jobs from
`node_modules/.vite/task-cache`; Vite Task still fingerprints the actual files,
arguments, and environment before replaying a result. Unit tests explicitly opt
out because the suite includes randomized property checks and Docker-backed
tests. Keep networked, credentialed, deployment, and other nondeterministic work
outside cached tasks unless it can be made hermetic first.

Docs deployment uses `mono docs deploy`. Normal `main` pushes update the dev
Netlify site, pull requests publish sticky and commit-specific aliases on the
dev site, and stable release publishing is the only workflow path that updates
the production docs domain. Use `mono docs deploy --plan` when changing deploy
routing logic; it prints the resolved site and target without building or
deploying.

Manual `workflow_dispatch` is used by the release workflow for generated release
PR branches. GitHub does not recursively trigger PR workflows from branches
pushed with `GITHUB_TOKEN`, so release automation explicitly dispatches CI for
the generated release branch.

## `release.yml`

Release orchestration workflow for the PR-driven release process.

Manual dispatch with `mode=create-release-pr` runs Changesets versioning on
`main`, writes `release/release-plan.json`, updates package versions and the
lockfile, and opens or updates a draft release PR such as
`automation/release-0.4.0`. The generated PR is the human review gate. Keep it
as draft until the release is intentionally ready to publish.

Manual dispatch with `mode=validate-release-plan`, or a PR that touches release
pipeline files, dry-runs the package publisher and public DevTools artifact
repack path. This checks the stable release machinery without publishing a
stable release.

DevTools artifact validation must preserve release cadence independence:
LiveStore releases are expected to happen more often than DevTools releases.
A normal LiveStore release must be able to ship with the already selected
DevTools artifact without checking out, building, or publishing from the
`overeng` repository. The release gate should re-verify the pinned artifact
against the LiveStore release candidate and require a new DevTools artifact only
when compatibility actually fails or DevTools itself changes.

On push to `main` when `release/release-plan.json` changes, the workflow publishes
the release group and the matching public DevTools artifact package. For stable
`latest` releases it then deploys the production docs, production examples, and
production docs search index. In normal operation this happens when the
supervised release PR is merged.

Manual dispatch with `mode=publish-release` reruns the publish job for the
checked-in release plan. Use it only after confirming the current `main` release
plan is still the intended release; the publisher is idempotent for already
published packages, but production deploys still reflect the checked-in release
state.

Manual dispatch with `mode=publish-snapshot`, or a successful `ci.yml` run for a
push to `main`, publishes the matching npm snapshot and DevTools artifact
snapshot. npm package publishing is centralized in `release.yml` because npm
allows one trusted publisher workflow per package. Publish jobs run on
GitHub-hosted runners with `id-token: write`; Namespace/self-hosted runners
remain available for the heavier validation jobs. Do not configure npm write
tokens for package publish jobs. Each published `@livestore/*` package must
trust `livestorejs/livestore` with workflow filename `release.yml` in npm
package settings.

Snapshot DevTools Chrome ZIPs are uploaded as short-lived workflow artifacts,
not GitHub Releases. Public GitHub Releases are reserved for dev/stable release
versions so the releases page remains a user-facing release history rather than
a CI snapshot log.

## `devtools-artifact.yml`

Maintains `release/devtools-artifact.json`, the public manifest that tells the
LiveStore release pipeline which sanitized DevTools artifact to repackage.

It can be triggered by `repository_dispatch` from the artifact-producing system
or manually with public artifact URLs and a SHA-256 checksum. It verifies the
manifest and opens a PR that only changes the public artifact metadata.

The manifest records artifact identity, not release certification. The
artifact-producing workflow may update URLs and checksums, but it must not mark
the artifact as shippable for a LiveStore release. Release validation produces
an ephemeral release-candidate certification after exact-artifact liveness
passes; repack and publish require that CI proof for release-channel versions.
The exact-artifact liveness gate disables DevTools license enforcement
explicitly via `LIVESTORE_DEVTOOLS_ENFORCE_LICENSE=false`; relying on a
maintainer's local sponsor activation would make the gate non-hermetic.

This workflow must not become a hidden prerequisite for ordinary LiveStore
releases. It is used when the selected DevTools artifact changes. Release PRs
that only change LiveStore should consume the checked-in artifact pointer and
prove compatibility in LiveStore CI.

Artifact URLs should point at build-id-only release tags such as
`devtools-artifact-dt-20260505-398c5feb`. The DevTools implementation version
may appear in public metadata for traceability, but it is not the artifact
release identity. When LiveStore republishes the artifact, the npm package and
Chrome ZIP release asset are versioned with the LiveStore release group or
snapshot version.

Artifact ordering should use artifact metadata such as `artifactVersion` or
`builtAt`. Runtime protocol compatibility is decided by
`devtoolsProtocolVersion`, not by matching package versions. Shipping
compatibility is decided by LiveStore release CI, so stale artifacts with broad
self-declared compatibility cannot be republished as a new LiveStore DevTools
package.

The workflow exists so the LiveStore repository can keep release CI
self-contained while the DevTools source remains outside this repository.

See [../../context/devtools-artifact-release/spec.md](../../context/devtools-artifact-release/spec.md)
for the release-scenario contract and certification model.

## `auto-review.yml`

Small workflow that requests review from `schickling` when `schickling-assistant`
opens or marks a PR ready for review.

Draft PRs are intentionally ignored. This keeps draft release PRs and other
work-in-progress branches visible without making them look ready for human
review.

## `sync-docs.yml`

Synchronizes documentation Markdown/MDX files from `main` into the Mixedbread
vector store used by docs search/RAG tooling. Pushes to `main` update the dev
search index. Manual dispatch can target either `dev` or `prod`; production
sync is also run by the stable release publish workflow.

It runs on pushes to `main` that touch docs content and can also be dispatched
manually. It is separate from the docs build/deploy jobs in `ci.yml`: CI verifies
and deploys the website, while this workflow updates the external search index.
