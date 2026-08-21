---
title: Minimal Setup
description: The lightweight setup for TypeScript-heavy LiveStore contributions.
---

Minimal Setup covers most TypeScript changes, stable core unit tests,
representative Vite and local Wrangler builds, and docs source checks. Use the
[Full Setup (Nix + devenv)](./full-setup/) when your work needs browsers,
generated sources, a SQLite distribution rebuild, releases, infrastructure, or
final repository-wide validation.

## Install the toolchain

Install [Node.js 24](https://nodejs.org/en/download),
[Bun](https://bun.sh/docs/installation), and the pnpm version declared by
`package.json#packageManager` using the
[official pnpm installation options](https://pnpm.io/installation). Confirm the
tools resolved from your shell:

```bash
node --version
bun --version
pnpm --version
```

Run a frozen install from the repository root:

```bash
pnpm install --frozen-lockfile
```

`./scripts/bootstrap-minimal.sh` is an optional diagnostic for people and
agents. It checks the same prerequisites and runs the frozen install, without
installing or upgrading tools globally.

## Validate your change

Setup only makes dependencies ready. Run the checks that match your work:

| Work              | Command                                                         |
| ----------------- | --------------------------------------------------------------- |
| Core TypeScript   | `pnpm exec tsc -b packages/@livestore/livestore --pretty false` |
| Stable core units | `pnpm --filter @livestore/common exec vitest run`               |
| Docs source       | `pnpm --filter @local/docs run check`                           |

Before a maintainer-ready handoff, use the full setup for any required checks
outside this table and rely on the complete CI bar.

## Docker (optional)

Docker provides a familiar, known-good realization and is also the CI
regression oracle for this lane:

```bash
docker compose build
LOCAL_UID="$(id -u)" LOCAL_GID="$(id -g)" docker compose run --rm development
```

Compose bind-mounts the source tree. Use an exclusive checkout and do not run
host and container installs concurrently. The image intentionally omits
browsers, generated-source tooling, Nix, release state, and infrastructure
tools.
