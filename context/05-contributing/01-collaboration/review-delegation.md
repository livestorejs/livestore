# Review delegation

A delegation rule has `paths` and an `owner` (`agent` or `johannes`); rules are ordered, first match wins, and the final `**` rule is the default. An independent agent's GO replaces Johannes's code review only when every changed file matches an agent rule; all other PRs require Johannes's code review. Merge still follows the repository's integration path and any merge authorization Johannes grants.

Delegated changes must add no complexity: no new abstraction, dependency, module boundary, or public surface. When classification or complexity is uncertain, escalate to Johannes.

## Ordered profile

Paths are repository-relative globs. Multiple paths in a rule are alternatives.

```yaml
rules:
  - paths:
      - '**/vision.md'
      - '**/requirements.md'
      - '**/decisions/**'
      - '**/.decisions/**'
      - context/05-contributing/01-collaboration/review-delegation.md
      - context/03-delivery/02-release/**
      - release/**
      - .changeset/**
      - scripts/src/commands/changesets.ts
      - scripts/src/commands/github.ts
      - scripts/src/commands/release*
      - scripts/src/commands/devtools-artifact*
      - scripts/src/shared/npm-publish*
      - scripts/src/generated/release-topology*
      - genie/release-topology.ts
      - packages/@livestore/*/package.json
      - packages/@livestore/*/package.json.genie.ts
      - '**/.npmrc'
      - '**/.env*'
      - '**/secrets/**'
      - '**/credentials/**'
      - .infra/**
      - scripts/src/meetings/google-calendar.ts
      - scripts/src/meetings/publish.ts
      - scripts/src/shared/netlify.ts
      - .github/CODEOWNERS
      - .github/repo-settings.json
      - .github/reconcile-app-manifest.json
      - .github/workflows/**
      - .github/scripts/**
      - .github/actions/**
      - .github/**/*.genie.ts
      - genie/ci.ts
      - genie/ci-scripts/**
      - genie/repo.ts
      - genie/pr-snapshot-paths.ts
      - genie/external.ts
      - genie/repo-topology.ts
      - nix/devenv-modules/tasks/local/**
    owner: johannes
  - paths: ['**/*.test.ts', '**/*.test.tsx', '**/*.test.js', '**/__tests__/**']
    owner: agent
  - paths:
      - .github/**
      - nix/**
      - devenv.*
      - genie/**
      - scripts/**
      - docs/**
      - examples/**
      - tests/**
      - contributor-docs/**
      - pnpm-lock.yaml
      - pnpm-workspace.yaml
      - package.json
      - package.json.genie.ts
      - pnpm-workspace.yaml.genie.ts
      - packages/**
      - context/**
      - CHANGELOG.md
    owner: agent
  - paths: ['**']
    owner: johannes
```

Package source, tests, and changelogs are delegated. Published package manifests and their generators retain Johannes's approval because they define publishing configuration. Root and tooling manifests and lockfiles remain delegated, subject to the no-added-dependency invariant. `contributor-docs/` contains contributor documentation and RFCs; a document does not authorize the implementation it proposes.

## GitHub projection

[CODEOWNERS](../../../.github/CODEOWNERS) is a manually maintained projection of this profile, not a genie output. It lists the broad agent paths first and human gates last because GitHub uses the last matching entry. Agent paths use ownerless entries to clear the default owner: naming `@schickling-assistant` would require an approval that the agent PR author cannot provide.

The `main-branch-rules` ruleset requires code-owner review and otherwise requires zero approvals. Ownerless-only changes therefore need no GitHub approval; required checks, resolved review threads, independent agent review, and merge authorization still apply. Vision, requirements, decisions, release and publishing tooling, credential consumers, workflows and their shared generators, repository security configuration, and this profile stay with Johannes. The workflow's transitive tooling trust boundary is tracked in [#1701](https://github.com/livestorejs/livestore/issues/1701); retaining the directly identified generators and credential consumers does not claim to close it. Repository settings are unchanged.

Run `node .github/scripts/check-codeowners.mjs` to check representative delegated and retained paths, including synthetic collisions with delegated test paths.

The existing [collaboration flow](./spec.md) and [changelog guide](../../../contributor-docs/changelog-guide.md) still apply; delegation does not waive contribution checks or release-ledger requirements.
