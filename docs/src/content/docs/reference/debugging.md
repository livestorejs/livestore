---
title: Debugging a LiveStore app
sidebar:
  label: Debugging
  order: 22
---

When working on a LiveStore app you might end up in situations where you need to debug things. LiveStore is built with debuggability in mind and tries to make your life as a developer as easy as possible.

Here are a few things that LiveStore offers to help you debug your app:

- [OpenTelemetry](/reference/opentelemetry) integration for tracing / metrics
- [Devtools](/reference/devtools) for inspecting the state of the store
- Store helper methods

## Debugging helpers on the store

The `store` exposes a `_dev` property which contains a few helpers that can help you debug your app.

## Other recommended practices and tools

- Use the step debugger