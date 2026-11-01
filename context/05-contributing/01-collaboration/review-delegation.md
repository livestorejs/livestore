# Review delegation

A delegation rule has `paths`, optional `kinds`, and an `owner` (`agent` or `johannes`); rules are ordered, first match wins, and the final `**` rule is the default. An independent agent's GO replaces Johannes's code review only when every changed file matches an agent rule without `kinds`; all other PRs require Johannes's code review. Merge still follows the repository's integration path and any merge authorization Johannes grants.

Delegated changes must add no complexity: no new abstraction, dependency, module boundary, or public surface. When classification or complexity is uncertain, escalate to Johannes.

## Ordered profile

Paths are repository-relative globs. Multiple paths in a rule are alternatives.

```yaml
rules:
  - paths:
      - release/**
      - .github/workflows/release.yml
      - scripts/src/commands/changesets.ts
      - scripts/src/commands/release.ts
      - scripts/src/commands/devtools-artifact.ts
      - .changeset/*.md
      - CHANGELOG.md
      - packages/@livestore/wa-sqlite/CHANGELOG.md
    kinds: [changelog, release-patch]
    owner: agent
  - paths: ['**/*.test.ts', '**/*.test.tsx', '**/*.test.js', '**/__tests__/**']
    owner: agent
  - paths: ['packages/@local/*/package.json', 'packages/@local/*/package.json.genie.ts']
    owner: agent
  - paths: [packages/**]
    kinds: [type-only, bugfix-with-test, deprecation]
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
    owner: agent
  - paths: ['**']
    owner: johannes
```

`type-only` changes affect types only. `bugfix-with-test` requires no public API change and a regression test in the same PR. `deprecation` marks existing functionality as deprecated; `changelog` covers release-note material; `release-patch` is a patch or development release through the existing release tooling. Kind-restricted rules retain Johannes's approval gate rather than granting path-wide delegation.

Dependency bumps in published package manifests need Johannes's approval. Root and tooling manifests and lockfiles are delegated, subject to the no-added-dependency invariant. `contributor-docs/` contains contributor documentation and RFCs; a document does not authorize the implementation it proposes.

## GitHub projection

[CODEOWNERS](../../../../.github/CODEOWNERS) projects these rules in reverse order because GitHub uses the last matching entry. Johannes-owned and kind-restricted rules use `@schickling`; unrestricted agent paths use ownerless entries to clear the default owner. The PR author is never listed as an approving code owner.

The `main-branch-rules` ruleset requires code-owner review and otherwise requires zero approvals. GitHub cannot classify change kinds, so restricted rules remain code-owned. Review of this profile itself falls under the default Johannes rule. Repository settings are unchanged.

The existing [collaboration flow](./spec.md) and [changelog guide](../../../../contributor-docs/changelog-guide.md) still apply; delegation does not waive contribution checks or release-ledger requirements.
