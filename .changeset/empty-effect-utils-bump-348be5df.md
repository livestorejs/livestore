---
---

No release impact (tooling/CI only). Bumps the `effect-utils` megarepo pin to `348be5df` (and `livestore-contrib` to `e941d6af`) and regenerates the workspace.

This fixes the broken `report-pr-preview` CI job: upstream removed the standalone `workflow-report` flake package (consolidated into `@overeng/ci-tools`), so the generated workflow's `nix run …/effect-utils/main#workflow-report` no longer resolved. Reporting now runs via the `devenv tasks run workflow-report:{collect-bundle,render-comment-body,publish}` task module.

Also adopts the upstream tooling contract that came with the bump: migrates off the removed `dt` task wrapper to `devenv tasks run`, adds the required `pnpm-install-contract.json` generated artifact, wires the `workflow-report` devenv task module, and picks up the genie CI/tsconfig generator changes.

Shared external dependency versions from effect-utils' catalog (react, `@tanstack/react-router`, vite, `@opentelemetry/*`, etc.) are intentionally held at their current versions here; the dependency upgrade and the Effect-LSP diagnostic burndown are tracked as separate follow-ups.
