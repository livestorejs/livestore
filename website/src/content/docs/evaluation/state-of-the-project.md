---
title: State of the project
description: A high-level overview of the current state of the project.
---

LiveStore is based on years of research (see [Riffle](https://riffle.systems/essays/prelude/)) and is used as the foundation for ambitious apps such as [Overtone](https://overtone.pro). LiveStore has been in development since 2021 and is getting closer to a stable release. LiveStore is not yet ready for production use but can already be used during development.

## Current state

- LiveStore is currently in *private early access* and available as an *alpha release*.
- **private early access**: To keep the development sustainable and level of feedback manageable, LiveStore is currently only available in early access to GitHub sponsors. We plan to offer public access to LiveStore early 2025.
- **alpha release**: LiveStore is still under heavy development which includes breaking changes and database resets during version upgrades. We expect LiveStore to reach a relatively stable state (beta) in the first half of 2025 and aiming for an initial stable release in the second half of 2025.

### On breaking changes

While LiveStore is in alpha there can be two kinds of breaking changes:

- Breaking API change
- Storage format changes (whenever `liveStoreStorageFormatVersion` is updated)

We try our best to minimize breaking changes and to provide a migration path whenever possible.

## Roadmap

See [GitHub issues](https://github.com/livestorejs/livestore/issues) for more details. Get in touch if you have any questions or feedback.

### Short-term

- Rebase syncing protocol [#195](https://github.com/livestorejs/livestore/issues/195)
- More testing

### Mid-term

- Support syncing in Expo adapter [#119](https://github.com/livestorejs/livestore/issues/119)
- Performance improvements

### Long-term

- Support more syncing backends
- Support more framework integrations
- Support more platforms (e.g. Electron, Tauri)
