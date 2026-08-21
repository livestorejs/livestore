---
title: Info
description: Notes for developers interested in contributing to LiveStore.
sidebar:
  order: 5
---

## Before contributing

First of all, thank you for your interest in contributing to LiveStore! Building LiveStore has been an incredible amount of work, so everyone interested in contributing is very much appreciated. 🧡

Please note that LiveStore is still in active development with many things yet subject to change (e.g. APIs, examples, docs, etc).

Before you start contributing, please check with the maintainers if the changes you'd like to make are likely to be accepted. Please get in touch via the `#contrib` channel on [Discord](https://discord.gg/RbMcjUAPd7).

## Development setup

### Minimal Setup

Most TypeScript, core unit-test, Vite, local Wrangler, and docs-check work uses
the host-native Minimal Setup. Install Node.js 24 and Bun, and provide the exact
pnpm version declared by `package.json#packageManager`. Then run:

```bash
./scripts/bootstrap-minimal.sh
```

The script verifies those prerequisites and performs a frozen dependency
install. It does not install or upgrade tools globally.

#### Docker (optional)

The repository also provides the known-good Node 24, pnpm 11.8.0, and Bun
1.3.13 toolchain as a container:

```bash
docker compose build
LOCAL_UID="$(id -u)" LOCAL_GID="$(id -g)" docker compose run --rm development
./scripts/bootstrap-minimal.sh
```

Compose bind-mounts the source tree, so use an exclusive checkout and do not run
host and container installs concurrently.

### Full setup with Nix and devenv

Use `devenv shell` for Playwright and full docs builds, generated-source or
wa-sqlite changes, releases, infrastructure, and repository-wide parity. The
exact boundary is maintained in the
[developer-environment contract](https://github.com/livestorejs/livestore/tree/main/context/03-delivery/01-composition/01-developer-environment/spec.md).

## Areas for contribution

There are many ways to contribute to LiveStore.

### Help wanted for ...

- You can look at ["help wanted" issues](https://github.com/livestorejs/livestore/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22) on GitHub for ideas.
- [SQLite WASM build](https://github.com/livestorejs/wa-sqlite) maintainer (e.g. keeping it up to date with upstream SQLite and wa-sqlite versions)
- Examples maintainer (e.g. keeping dependencies & best practices up to date)
- Solid integration maintainer (e.g. keeping it up to date with upstream Solid versions)

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
- Changes to the docs site/setup

**Note:** For significant changes to public APIs or core architecture, consider writing an [RFC (Request for Comments)](https://github.com/livestorejs/livestore/tree/main/contributor-docs/rfcs) first to gather feedback before implementation.

### Out of scope (for now)

- Changes to the landing page
- Changes to the devtools
- Rewriting the core library in a different language

### Open research questions

- Safer event schema evolution
- Incremental view maintenance for complex SQLite database views

Please get in touch if you'd like to discuss any of these topics!

## Bug reports

- Please include a [minimal reproducible example](https://stackoverflow.com/help/minimal-reproducible-example) for how to reproduce the bug.

## Pull requests

Every pull request must include a changeset. Use a normal changeset for
user-visible or package-affecting changes, and use an empty changeset for
changes that do not need release notes:

```bash
pnpm exec changeset
pnpm exec changeset add --empty
```

See [`.changeset/README.md`](https://github.com/livestorejs/livestore/tree/main/.changeset#readme)
for the short contributor-facing rule and
[`context/03-delivery/02-release/release-workflows-runbook.md`](https://github.com/livestorejs/livestore/blob/main/context/03-delivery/02-release/release-workflows-runbook.md)
for the maintainer release workflow.

## Guiding principles {#guiding-principles}

- Keep it as simple as possible
- Reduce surface area
- Make the right thing easy
- Document the "why"
