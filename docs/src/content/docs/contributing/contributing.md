---
title: Contributing
description: Notes for developers interested in contributing to LiveStore.
sidebar:
  order: 5
---

## Before contributing

First of all, thank you for your interest in contributing to LiveStore! Building LiveStore has been an incredible amount of work, so everyone interested in contributing is very much appreciated. 🧡

Please note that LiveStore is still in active development with many things yet subject to change (e.g. APIs, examples, docs, etc).

Before you start contributing, please check with the maintainers if the changes you'd like to make are likely to be accepted. Please get in touch via the `#contrib` channel on [Discord](https://discord.gg/RbMcjUAPd7).

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

**Note:** For significant changes to public APIs or core architecture, consider writing an [RFC (Request for Comments)](/contributor-docs/rfcs) first to gather feedback before implementation.

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

## Guiding principles {#guiding-principles}

- Keep it as simple as possible
- Reduce surface area
- Make the right thing easy
- Document the "why"
