# GitHub Workflows

Most workflow YAML files in this directory are generated from sibling
`.genie.ts` files. Edit the `.genie.ts` source and run `genie`; do not edit the
generated YAML directly. `sync-docs.yml` is currently handwritten.

## `ci.yml`

Primary validation workflow for pull requests, `main` pushes, and manual
workflow-dispatch runs. `main` is the canonical default and release branch.

It runs the normal repository quality gates: linting, Changesets release-intent
checks, TypeScript builds, unit tests, integration tests, Playwright tests,
performance tests, docs/examples builds, and dev docs/examples deploys.

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

On push to `main` when `release/release-plan.json` changes, the workflow prepares,
validates, and publishes the release group and matching public DevTools artifact
package. In normal operation this happens when the supervised release PR is merged.
The stable job chain is `prepare-release` → `validate-release` →
`publish-release` → `finalize-release`. Finalization handles GitHub Release
metadata and the optional DevTools Chrome ZIP separately from npm authority.

Manual dispatch with `mode=publish-release` reruns this chain for the checked-in
release plan. Use it only after confirming the current `main` release plan is
still the intended release. Already-published packages must match the prepared
tarball integrity before a retry treats them as complete.

Manual dispatch with `mode=publish-snapshot`, or a successful `ci.yml` run for a
push to `main`, publishes the matching npm snapshot and DevTools artifact
snapshot. npm package publishing is centralized in `release.yml` because npm
allows one trusted publisher workflow per package. Publish jobs run on
GitHub-hosted runners with `id-token: write`; Namespace/self-hosted runners
remain available for the heavier validation jobs. Do not configure npm write
tokens for package publish jobs. Each published `@livestore/*` package must
trust `livestorejs/livestore` with workflow filename `release.yml` in npm
package settings.

The main-snapshot chain is `prepare-snapshot-version` →
`validate-snapshot-version` → `publish-snapshot-version`. Both stable and
main-snapshot preparation build and pack core packages and repack the selected
`@livestore/devtools-vite` artifact before npm authority exists. Stable preparation
also preserves release-candidate liveness certification. They stage a
`release-artifact` directory containing tarballs and `manifest.json`
(schema version 1, source SHA, version, npm tag, and package
name/version/filename/SHA-512 SRI/tag records). Stable preparation can also stage
the Chrome ZIP and `release-notes.md`.

The separate validation jobs have no secrets or OIDC permission. They validate
the manifest, expected release topology plus `@livestore/devtools-vite`, package
contents, and integrity before handing the exact bytes to publishing. The
credentialed publish jobs do not check out the repository, install dependencies,
build, run `mono`, or execute package lifecycle scripts. Only shell orchestration
and `npm publish --ignore-scripts --provenance` perform npm publication, with
hashes rechecked against the validated handoff. Hashes protect byte identity
between jobs. They do not prove that a compromised prepare/build produced safe
code, or remove the trust placed in reviewed source and build dependencies.

The stable (`publish-release`) and main-snapshot (`publish-snapshot-version`)
jobs use the `npm-publish` GitHub environment; PR-snapshot publishing does not.
Before the first publish, an administrator must configure that environment with
selected deployment branches restricted to `main`, no deployment tags, and no
required reviewers. GitHub otherwise auto-creates an unprotected environment
when a workflow first references it. This workflow has no release-tag trigger.
An administrator applies this policy out of band; P4 IaC will declare it later.
Inspect the effective policy before the first publish:

```sh
gh api repos/livestorejs/livestore/environments/npm-publish
gh api repos/livestorejs/livestore/environments/npm-publish/deployment-branch-policies --jq '.branch_policies[]|{name,type}'
```

The result must contain exactly one rule, `{name: main, type: branch}`.
Delete any other rule, including tag rules, before the first publish.

Only the main-snapshot job condition restricts its source CI run to this
repository's `main`. The workflow-wide `workflow_run` trigger remains broader
for PR snapshots, and uses the default-branch ref regardless of the source branch.

The npm trusted-publisher environment field is [optional](https://docs.npmjs.com/trusted-publishers/#for-github-actions).
When it is unset, adding a GitHub environment does not require changing npm's
trusted-publisher configuration. Binding npm's trusted publisher to `npm-publish`
(Q278) would make `publish-pr-snapshot` fail because that job has no environment.
Q278 must therefore either give the PR-snapshot publisher its own environment
or leave the npm environment unset.

A successful `ci.yml` run for any pull request packs an immutable candidate for
the exact head as
`0.0.0-snapshot-pr.<number>.<40-character-head-sha>`.
The PR job only packs the fixed public package cohort on a GitHub-hosted runner
without secrets, write permissions, or OIDC. The default-branch `release.yml`
validation job re-resolves the open PR from the completed run, requires its
current head to match, validates the run-bound manifest and every tarball, and
uploads a short-lived immutable artifact for pre-review E2E. This parser job has
no OIDC permission. A separate job hashes the validated handoff without parsing
package archives and creates a custom GitHub attestation that binds the package
and manifest digests to the exact PR head, source CI run, and trusted release
topology.

npm promotion for repository-owned PRs uses the ordinary required code-review
decision as its manual trust boundary. GitHub's authoritative review decision must be
`APPROVED`, and a counting approval must name the current head commit. An
approval for an earlier head, a non-counting approval, or a later changes request
does not authorize publication. Approval before CI is observed when CI completes.
For approval after CI, the trusted default-branch workflow polls authorized open
PRs every five minutes and dispatches `release.yml` explicitly at `main`; it does
not grant workflow-write authority to PR-controlled review-event code. The
dispatched run treats PR and head inputs only as selectors, then resolves and
validates the exact successful CI producer again. The OIDC job rechecks the unchanged
head and approval immediately before publishing. It never checks out or executes
the PR head and publishes the validated tarballs directly with scripts disabled
under the deterministic `pr-<number>-<40-character-head-sha>` tag. Exact package
versions and registry digests are the immutable cohort identity. The mutable npm
tag is convenience metadata: retries accept it when absent, reject it when bound
to another version, and do not introduce a long-lived token to repair it because
npm trusted publishing authenticates publish operations only. A trusted
verification receipt is uploaded only after every registry integrity matches the
validated candidate; the scheduler redispatches until that exact PR head, CI run,
and pack attempt receipt exists. npm provenance identifies this trusted default-branch promotion
workflow; the custom candidate attestation supplies the separate link back to PR CI.

Fork PRs use the maintainer-managed `ci:publish-snapshot` label instead of
review approval. The label trusts the PR's mutable head repository and branch,
including later commits while it remains present. The trusted workflow resolves
fork producers by exact repository, branch, and SHA and rechecks the live label
and unchanged head immediately before publication. Removing the label stops
publication that has not started.

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
DevTools artifacts do not require a sponsor license. The exact-artifact liveness
gate runs without a license-enforcement override or local activation state.

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

## Namespace queue priorities

The shared capacity policy uses explicit `job.priority` runner features. Lower
numbers start first among waiting jobs; running jobs are not preempted. Priorities
reserve no capacity and apply independently to Linux and macOS pools.

| Priority | Work                                                                      |
| -------- | ------------------------------------------------------------------------- |
| 1        | effect-utils required CI, delivery verification, releases and deployments |
| 2        | Smalltalk, PTY and similar tooling dependencies: equivalent delivery work |
| 3        | LiveStore delivery work                                                   |
| 4        | effect-utils background work                                              |
| 5        | Smalltalk and tooling background work                                     |
| 6        | LiveStore background work                                                 |

LiveStore's `namespaceRunner` helper defaults to delivery priority 3. Required
checks and their prerequisites, main verification, release orchestration,
docs/examples builds and deployments, and DevTools artifact verification use
that default. The optional `perf-test` and independent `publish-nix-cache`
jobs use background priority 6. Neither supplies a
required check or a prerequisite for delivery jobs. The source-policy job keeps
priority 3 wherever it is reused, including release and deployment workflows.
A scheduled verification job retains delivery priority; its trigger alone does
not make it background work. GitHub-hosted runners do not consume Namespace
capacity and retain their existing routing.

The helper delegates runner labels to effect-utils with `privileged: 'trusted'`.
Linux jobs from trusted events and same-repository pull requests request
`container.privileged=true` so Nix's strict sandbox can create kernel namespaces.
Fork pull requests do not receive privileged containers. Nix sandboxing remains
enabled with fallback disabled.

This policy leaves runner shapes, caches, access controls, required checks,
triggers, cancellation, test frequency and account limits unchanged.
