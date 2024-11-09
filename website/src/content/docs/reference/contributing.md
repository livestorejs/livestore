---
title: Contributing
description: Notes for developers interested in contributing to the LiveStore monorepo.
---

## Before contributing

- Please note that LiveStore is still in active development and APIs are subject to change.
- Before you start contributing, please check with the maintainers if the changes you'd like to make are likely to be accepted. Discord is the best way to get in touch.

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
pnpm generate:examples:dist
pnpm install
pnpm build
```

## Monorepo

- This project uses [pnpm](https://pnpm.io/) to manage the workspace.
- We also make heavy use of TypeScript project references.

### Examples

- Once you've set up the monorepo locally, you'll notice both the `src` and `dist` directories in `/examples`.
- The `/examples/dist` directory is meant as source for app developers using LiveStore. To improve maintainability, the `dist` directory is a git-submodule pointing to the [`livestorejs/examples` repo](https://github.com/livestorejs/examples).
- The `/examples/src` directory is meant for LiveStore maintainers and to run as part of the LiveStore monorepo. Compared to `/examples/dist` it makes use of local linking features such a `workspace:*`, TypeScript `references` etc.
- Both directories are kept in sync via `/examples/patches` and `/scripts/generate-examples.ts`. Usually it's recommended to work in `/examples/src` and generate the `/examples/dist` version via `pnpm generate:examples:dist`.

#### Making changes to examples

1. Make your desired changes in `/examples/src`. (You might also need to update some of the patches in `/examples/patches`.)
2. Run `pnpm generate:examples:dist` to generate the `/examples/dist` version
3. Check whether the changes in `/examples/dist` are what you expected.
4. Commit your changes in the examples submodule and update the submodule reference in your git commit.

## Devtools

- The source code of the devtools is currently not part of this monorepo but in a separate private repo.