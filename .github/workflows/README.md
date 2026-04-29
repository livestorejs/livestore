# GitHub Workflows

Most workflow YAML files in this directory are generated from sibling
`.genie.ts` files. Edit the `.genie.ts` source and run `genie`; do not edit the
generated YAML directly. `sync-docs.yml` is currently handwritten.

## `ci.yml`

Primary validation workflow for pull requests, `dev`/`main` pushes, and manual
workflow-dispatch runs.

It runs the normal repository quality gates: linting, Changesets release-intent
checks, TypeScript builds, unit tests, integration tests, Playwright tests,
performance tests, docs/examples builds, snapshot publishing, DevTools artifact
snapshot publishing, and create-example smoke tests.

The snapshot and create-example jobs are intentionally part of CI. They verify
that the exact commit under test can publish snapshot packages and that users
can create projects from those snapshots. Forked PRs skip jobs that require
repository secrets or publishing permissions.

Manual `workflow_dispatch` is used by the release workflow for generated release
PR branches. GitHub does not recursively trigger PR workflows from branches
pushed with `GITHUB_TOKEN`, so release automation explicitly dispatches CI for
the generated release branch.

## `release.yml`

Release orchestration workflow for the PR-driven release process.

Manual dispatch with `mode=create-release-pr` runs Changesets versioning on
`dev`, writes `release/release-plan.json`, updates package versions and the
lockfile, and opens or updates a draft release PR such as
`automation/release-0.4.0`. The generated PR is the human review gate. Keep it
as draft until the release is intentionally ready to publish.

Manual dispatch with `mode=validate-release-plan`, or a PR that touches release
pipeline files, dry-runs the package publisher and public DevTools artifact
repack path. This checks the stable release machinery without publishing a
stable release.

On push to `dev` when `release/release-plan.json` changes, the workflow publishes
the release group and the matching public DevTools artifact package. In normal
operation this happens when the supervised release PR is merged.

Manual dispatch with `mode=publish-release` reruns the publish job for the
checked-in release plan. Use it only after confirming the current `dev` release
plan is still the intended release; the publisher is idempotent for already
published packages.

The publish job uses the repository `NPM_TOKEN` secret. Snapshot publishing uses
npm trusted publishing from `ci.yml`; stable/dev release publishing should move
to trusted publishing too once `release.yml` is authorized for the npm packages.

## `devtools-artifact.yml`

Maintains `release/devtools-artifact.json`, the public manifest that tells the
LiveStore release pipeline which sanitized DevTools artifact to repackage.

It can be triggered by `repository_dispatch` from the artifact-producing system
or manually with public artifact URLs and a SHA-256 checksum. It verifies the
manifest and opens a PR that only changes the public artifact metadata.

The workflow exists so the LiveStore repository can keep release CI
self-contained while the DevTools source remains outside this repository.

## `auto-review.yml`

Small workflow that requests review from `schickling` when `schickling-assistant`
opens or marks a PR ready for review.

Draft PRs are intentionally ignored. This keeps draft release PRs and other
work-in-progress branches visible without making them look ready for human
review.

## `sync-docs.yml`

Synchronizes documentation Markdown/MDX files from `main` into the Mixedbread
vector store used by docs search/RAG tooling.

It runs on pushes to `main` that touch docs content and can also be dispatched
manually. It is separate from the docs build/deploy jobs in `ci.yml`: CI verifies
and deploys the website, while this workflow updates the external search index.
