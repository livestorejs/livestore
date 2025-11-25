---
title: Electron Adapter
sidebar:
  order: 20
---

## Using LiveStore with Electron

LiveStore can already be used in Electron through the [web adapter](/reference/platform-adapters/web-adapter), which works perfectly fine for most use cases. The web adapter leverages the browser APIs available in Electron's renderer process, providing full LiveStore functionality including reactive queries, offline-first operation, and sync capabilities.

## Native Electron Adapter

While the web adapter works well, there is room for further improvement through a dedicated native Electron adapter. A native adapter would leverage Electron's unique capabilities including:

- **Transparent database file persistence** - Direct file system access instead of browser storage abstractions (IndexedDB/OPFS)
- **Performance improvements** - Native SQLite bindings via Node.js integration
- **Better integration with Electron's main process** - Coordination between main and renderer processes

Development of the native Electron adapter is tracked in [this GitHub issue](https://github.com/livestorejs/livestore/issues/296). Contributors are welcome to help with the implementation, and sponsorship opportunities are available to accelerate development of this adapter.
