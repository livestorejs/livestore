---
title: State of the project
description: A high-level overview of the current state of the project.
sidebar:
  order: 4
---

LiveStore is based on years of research (see [Riffle](https://riffle.systems/essays/prelude/)) and is used as the foundation for ambitious apps such as [Overtone](https://overtone.pro). LiveStore has been in development since 2021 and is making good progress towards a stable release. LiveStore is not yet ready for all production scenarios.

## Current state

LiveStore is currently in **beta** with most APIs being fairly stable (there might still be some breaking changes in coming releases). Most work is currently focussed on reliability and performance improvements.

There is currently no specific timeline for a 1.0 release but we are making good progress in that direction.

### On breaking changes

While LiveStore is in beta there can be three kinds of breaking changes:

- Breaking API changes
- Client storage format changes (whenever `liveStoreStorageFormatVersion` is updated)
- Sync backend storage format changes (e.g. when a sync backend implementation changes the way how it stores data)

We try our best to minimize breaking changes and to provide a migration path whenever possible.

## Roadmap

See [GitHub issues](https://github.com/livestorejs/livestore/issues) for more details. Get in touch if you have any questions or feedback.

### 2025 Q3

- Adapter bug fixes & stability improvements
- Performance improvements
  - Syncing latency & throughput
- More testing

### Long-term

- Eventlog compaction [#136](https://github.com/livestorejs/livestore/issues/136)
- Support more syncing providers
- Support more framework integrations
- Support more platforms (e.g. Electron, Tauri)
