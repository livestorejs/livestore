---
title: Contributing
description: Notes for developers interested in contributing to the LiveStore monorepo.
---

## Requirements

### Recommended: Nix + direnv

To make development as easy and consistent across systems and platforms, this project uses [Nix](https://nix.dev/) to manage "system dependencies" such as Node.js, Bun etc.

You can either manually use the Nix env via e.g. `nix develop --command pnpm 

### Manual setup

You'll need to have a recent version the following tools installed:

- Node.js
- Bun
- pnpm

## Local setup

```bash
git clone git@github.com:livestorejs/livestore.git
cd livestore
direnv allow
pnpm setup:monorepo-examples
pnpm install
pnpm build
```

## Monorepo

- This project uses [pnpm](https://pnpm.io/) to manage the workspace.
- We also make heavy use of TypeScript project references.

### Examples

- Once you've set up the monorepo locally, you'll notice both the `/examples` and `/examples-monorepo` directories.
- The `/examples` directory is meant as source for LiveStore users and is usually cloned via `tiged`
- The `/examples-monorepo` directory is meant for LiveStore maintainers and to run as part of the LiveStore monorepo. Compared to `/examples` it makes use of local linking features such a `workspace:*`, TypeScript `references` etc.
- Both directories are kept in sync via `/patches/examples` and `/scripts/sync-examples.ts`.

## Devtools

- The source code of the devtools is currently not part of this monorepo but in a separate private repo.