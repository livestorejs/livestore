---
title: Contributing
description: Notes for developers interested in contributing to LiveStore.
sidebar:
  order: 5
---

## Before contributing

- Please note that LiveStore is still in active development and APIs are subject to change.
- Before you start contributing, please check with the maintainers if the changes you'd like to make are likely to be accepted. Discord is the best way to get in touch.

## Areas for contribution

### Help wanted for ...

- SQLite WASM build maintainer (e.g. keeping it up to date with upstream SQLite and wa-sqlite versions)
- Examples maintainer (e.g. keeping dependencies & best practices up to date)
- Svelte integration maintainer (e.g. keeping it up to date with upstream Svelte and svelte-kit versions)

### In scope and encouraged

- Documentation improvements
- Improving examples
- Test cases
- Bug fixes
- Benchmarking

### Potentially in scope

- New features
- Larger architectural changes in the core library
- Adding new examples
- Adding new integrations (e.g. for technologies such as Svelte, Vue, ...)
- Monorepo setup changes

### Out of scope (for now)

- Changes to the website
- Changes to the devtools
- Rewriting the core library in a different language

## Requirements (for code contributions)

### Recommended software experience

- Deep experience with TypeScript (incl. type-level programming)
- Experience with distributed systems
- Effect (with some experience with functional programming)

### Recommended: Use Nix + direnv for a consistent development setup

To make development as easy and consistent across systems and platforms, this project uses [Nix](https://zero-to-nix.com/) to manage "system dependencies" such as Node.js, Bun etc. You can either use [Direnv](https://direnv.net) setup (recommended) to automatically load the Nix env or manually use the Nix env (e.g. via `nix develop --command pnpm install`).

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
pnpm install
pnpm build
```

## Monorepo

- This project uses [pnpm](https://pnpm.io/) to manage the workspace.
- We also make heavy use of TypeScript project references.

### VSCode tasks

- This project is primarily developed in VSCode and makes use of [tasks](https://code.visualstudio.com/docs/editor/tasks) to run commands.
- Common tasks are:
  - `dev:ts` to run the TypeScript compiler in watch mode for the entire monorepo
  - `pnpm:install` to install all dependencies (e.g. when changing a `package.json`)

### Examples

- Once you've set up the monorepo locally, you'll notice both the `src` and `standalone` directories in `/examples`.
- The `/examples/standalone` directory is meant as a starting point for app developers evaluating LiveStore and looking for a ready-to-run example app.
- The `/examples/src` directory is meant for LiveStore maintainers and to run as part of the LiveStore monorepo. Compared to `/examples/standalone` it makes use of local linking features such a `workspace:*`, TypeScript `references` etc.
- Both directories are kept in sync via `/examples/patches` and `/scripts/generate-examples.ts`. Usually it's recommended to work in `/examples/src` and generate the `/examples/standalone` version via `pnpm -w generate:examples:standalone`.

#### Making changes to examples

1. Make your desired changes in `/examples/src`. (You might also need to update some of the patches in `/examples/patches`.)
2. Run `pnpm generate:examples:standalone` to generate the `/examples/standalone` version
3. Check whether the changes in `/examples/standalone` are what you expected.
4. Commit your changes in both `/examples/src` and `/examples/standalone` (and possibly `/examples/patches`). Note on GitHub, changes to `examples/standalone` are hidden by default.

### OpenTelemetry setup

As a local OpenTelemetry setup, we recommend the [docker-otel-lgtm](https://github.com/grafana/docker-otel-lgtm) setup.

Add the following to your `.envrc.local` file:

```bash
export VITE_GRAFANA_ENDPOINT="http://localhost:30003"
export GRAFANA_ENDPOINT="http://localhost:30003"
export OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:4318"
export VITE_OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:4318"
```

### TypeScript

- Each package has its own `tsconfig.json` file which extends the root `tsconfig.base.json`.
- This project makes heavy use of TypeScript project references.

### Package management

- This project uses [pnpm](https://pnpm.io/) to manage the workspace.
- We're using the `workspace:*` protocol to link packages together.
- We should try to keep dependencies to an absolute minimum and only add them if we absolutely need them.
- We also need to manually add peer dependencies for each package.
- We should try to avoid duplicate dependencies across the monorepo as much as possible as duplicate dependencies can lead to a lot of issues and pain.
  - We're also using the `resolutions` field in the root `package.json` to force some packages to be the same across the monorepo (ideally not needed but for some packages it's necessary currently).
- We're using [syncpack](https://github.com/JamieMason/syncpack) to help maintain consistent dependency versions across the monorepo.
  - See `syncpack.config.mjs` for the configuration.
  - Common commands:
    - `bunx syncpack format` to format the `package.json` files
    - `bunx syncpack lint` to check all version ranges
    - `bunx syncpack fix-mismatches` to adjust versions across `package.json` files (check before with `lint`)
    - `bunx syncpack update` to update packages across the monorepo to the latest versions

#### Updating dependencies

- Either update the versions manually in each `package.json` file or use `bunx syncpack update`.

### Notes on packages

- The `@livestore/utils` package re-exports many common modules/functions (e.g. from `effect`) in order to
  - Reduce the number of direct dependencies for other packages
  - Allows for convenient extension of modules (e.g. adding methods to `Effect.___`, `Schema.___`, ...)

## Effect

- LiveStore makes heavy use of the [Effect](https://effect.website) library and ecosystem throughout the implementation of the various packages.
- Effect is not imposed on the app developers using LiveStore but where it makes sense, LiveStore is also exposing a Effect-based API (e.g. `createStore`).

## Devtools

- The source code of the devtools is currently not part of this monorepo but in a separate private repo.
