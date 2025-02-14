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

## Requirements

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
- Both directories are kept in sync via `/examples/patches` and `/scripts/generate-examples.ts`. Usually it's recommended to work in `/examples/src` and generate the `/examples/standalone` version via `pnpm generate:examples:standalone`.

#### Making changes to examples

1. Make your desired changes in `/examples/src`. (You might also need to update some of the patches in `/examples/patches`.)
2. Run `pnpm generate:examples:standalone` to generate the `/examples/standalone` version
3. Check whether the changes in `/examples/standalone` are what you expected.
4. Commit your changes in both `/examples/src` and `/examples/standalone` (and possibly `/examples/patches`). Note on GitHub, changes to `examples/standalone` are hidden by default.

### OpenTelemetry setup

As a local OpenTelemetry setup, we recommend the [docker-otel-lgtm](https://github.com/grafana/docker-otel-lgtm) setup.

```bash
export DEVSERVER_HOSTNAME="localhost"

# export VITE_OTEL="0" # disables Otel tracing
export VITE_OTEL="1" # enables Otel tracing for vite apps

# Grafana endpoint
export VITE_TRACING_UI_ENDPOINT="http://${DEVSERVER_HOSTNAME}:3000"
export TRACING_UI_ENDPOINT="http://${DEVSERVER_HOSTNAME}:3000"

export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT="http://${DEVSERVER_HOSTNAME}:4318/v1/traces"
export OTEL_EXPORTER_OTLP_METRICS_ENDPOINT="http://${DEVSERVER_HOSTNAME}:4318/v1/metrics"

export VITE_OTEL_EXPORTER_OTLP_TRACES_ENDPOINT="${OTEL_EXPORTER_OTLP_TRACES_ENDPOINT}"
export VITE_OTEL_EXPORTER_OTLP_METRICS_ENDPOINT="${OTEL_EXPORTER_OTLP_METRICS_ENDPOINT}"
```


## Devtools

- The source code of the devtools is currently not part of this monorepo but in a separate private repo.