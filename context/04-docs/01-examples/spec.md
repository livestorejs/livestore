# Examples — Spec

This document specifies the example-app surface. It builds on
[requirements.md](./requirements.md).

## Status

Draft.

## Inventory

The `examples/` directory is the source of truth for the inventory — this
spec deliberately does not enumerate it (frozen lists rot; e.g. the
react-router todomvc variant was removed mid-2026).

Naming: `<platform>-<app>[-<variant>]`; the directory name is the deploy
slug.

## Workflows

- `mono examples run` — run an example locally.
- `mono examples test` — CI integration pass over examples
  (LS.DOCS.EX-R02).
- `mono examples deploy` — Cloudflare Workers deployment per branch tier
  (LS.DOCS.EX-R04): `main` → `example-<slug>-dev`, PR/feature branches →
  `example-<slug>-preview`, stable release (`--prod`) → `example-<slug>`,
  each at `*.livestore.workers.dev`. Companion runbook:
  [`contributor-docs/examples-cloudflare.md`](../../../contributor-docs/examples-cloudflare.md)
  (owned by this node).

## Open Design Questions

- **LS.DOCS.EX-DQ1 Coverage matrix.** Which pluggable-dimension combinations
  (adapter × sync provider × framework) examples must cover — and which gaps
  are acceptable — is undefined.
