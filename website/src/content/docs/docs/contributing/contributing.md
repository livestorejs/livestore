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

You can look at ["help wanted" issues](https://github.com/livestorejs/livestore/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22) on GitHub for ideas.

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
- Changes to the docs site/setup

### Out of scope (for now)

- Changes to the landing page
- Changes to the devtools
- Rewriting the core library in a different language

## Requirements (for code contributions)

### Recommended software experience

- Deep experience with TypeScript (incl. type-level programming)
- Experience with distributed systems
- Experience with [Effect](https://effect.website) (or willingness to learn)

## Guiding principles {#guiding-principles}

- Keep it as simple as possible
- Reduce surface area
- Make the right thing easy
- Document the "why"
