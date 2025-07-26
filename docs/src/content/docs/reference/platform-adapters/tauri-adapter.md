---
title: Tauri Adapter
sidebar:
  order: 20
---

## Native Tauri Adapter

While LiveStore doesn't yet support a native Tauri adapter (see [this issue](https://github.com/livestorejs/livestore/issues/125) for more details), you can already use the [web adapter](./web-adapter.md) with Tauri.

The goal of the native Tauri adapter is for LiveStore to leverage native platform APIs and capabilities including:

- Native file system access (instead of going through the browser abstraction layer)
- Background sync capabilities
- ...

## Example using the web adapter

See this example of a Tauri app using the web adapter: [tauri-todomvc-sync-cf](https://github.com/bohdanbirdie/tauri-todomvc-sync-cf)