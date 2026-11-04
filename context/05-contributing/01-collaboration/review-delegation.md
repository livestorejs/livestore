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
      - scripts/**
      - genie/**
      - nix/**
      - devenv.*
      - docs/**
      - examples/**
      - tests/integration/**
      - tests/sync-provider/src/providers/**
      - tests/sync-provider/src/prepare-ci.ts
      - tests/sync-provider/src/types.ts
      - packages/@livestore/common/src/**
      - packages/@livestore/common-cf/src/**
      - packages/@livestore/effect-playwright/src/**
      - packages/@livestore/utils/src/**
      - packages/@livestore/utils-dev/src/**
      - packages/@livestore/webmesh/src/**
      - packages/@livestore/sync-cf/src/client/**
      - packages/@livestore/sync-cf/src/common/**
      - packages/@local/astro-tldraw/src/**
      - packages/@local/astro-twoslash-code/src/**
      - packages/@local/shared/src/**
      - '**/package.json'
      - '**/tsconfig*.json'
      - '**/tsconfig*.ts'
      - pnpm*
      - megarepo.*
      - '**/*.genie.ts'
      - '**/.npmrc'
      - '**/.env*'
      - '**/secrets/**'
      - '**/credentials/**'
      - .infra/**
      - .github/CODEOWNERS
      - .github/repo-settings.json
      - .github/reconcile-app-manifest.json
      - .github/workflows/**
      - .github/scripts/**
      - .github/actions/**
    owner: johannes
  - paths: ['**/*.test.ts', '**/*.test.tsx', '**/*.test.js', '**/__tests__/**']
    owner: agent
  - paths:
      - .github/**
      - tests/**
      - contributor-docs/**
      - packages/**
      - context/**
      - CHANGELOG.md
    owner: agent
  - paths: ['**']
    owner: johannes
```

Package source outside credentialed runtime trees, ordinary tests, and changelogs are delegated. Install manifests, locks, generators, aliases, dynamic deployment surfaces, and runtime imports reachable from credentialed jobs retain Johannes's approval. `contributor-docs/` contains contributor documentation and RFCs; a document does not authorize the implementation it proposes.

## GitHub projection

[CODEOWNERS](../../../.github/CODEOWNERS) is a manually maintained projection of this profile, not a genie output. It lists the broad agent paths first and human gates last because GitHub uses the last matching entry. Agent paths use ownerless entries to clear the default owner: naming `@schickling-assistant` would require an approval that the agent PR author cannot provide.

The `main-branch-rules` ruleset requires code-owner review and otherwise requires zero approvals. Ownerless-only changes therefore need no GitHub approval; required checks, resolved review threads, independent agent review, and merge authorization still apply. Human gates include the conservative executable closure of deployment, meeting/service-account, GitHub-write-token, npm/release, and App-key jobs. Re-owning the launcher, setup inputs, and imported tooling also contains part of the existing [#1701](https://github.com/livestorejs/livestore/issues/1701) gap; it is not full job isolation. Repository settings are unchanged.

Grafana OTLP telemetry auth is explicitly excluded from that closure: ordinary test code can read and misuse the write-only token exported through `GITHUB_ENV`. This accepted low-impact exception does not apply to Netlify trace uploads: their same-job Playwright predecessors and runtime imports are retained. Published source outside the credential closure may change without Johannes reviewing each source PR; his release approval controls publication of the accumulated artifact, not per-change source review.

Root `CHANGELOG.md` remains delegated despite Astro importing it as Markdown: frontmatter could select an existing layout module. This content risk is accepted to avoid gating nearly every agent PR; docs and dependency/lockfile authority stay retained. A frontmatter-rejection lint can further restrict this boundary without changing changelog ownership.

Run `node .github/scripts/check-codeowners.mjs` for sample precedence and `bun .github/scripts/check-credential-closure.mjs` for the credentialed-job inventory and transitive runtime import audit. The latter parses workflow YAML and JS/TS (including Astro/MDX module blocks), erases type-only imports, and resolves workspace exports without executing source. It combines that graph with conservative dynamic discovery surfaces (Nix, setup generators, docs/MDX/plugins, example builds, and Playwright job predecessors). Markdown/snippet assets and verified npm tarballs are data, not executable imports. External member code is bounded by protected pins. New dynamic execution mechanisms require review of the audit roots.

The existing [collaboration flow](./spec.md) and [changelog guide](../../../contributor-docs/changelog-guide.md) still apply; delegation does not waive contribution checks or release-ledger requirements.
