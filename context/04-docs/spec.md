# Docs — Spec

This document specifies the documentation system. It builds on
[requirements.md](./requirements.md).

## Status

Draft.

## Scope

Defines: the derivation mechanics, information architecture, snippet
pipeline, and diagram policy. Does not define example apps (see
[01-examples/](./01-examples/requirements.md)) or contribution workflow
(`05-contributing/`).

## Derivation Mechanics (LS.DOCS-R01, R02)

- VRS nodes are the source; docs pages render their content for users.
- `01-product/spec.md` maintains the mapping for overview pages; system
  nodes own the pages describing their subsystem.
- When a VRS contract changes, the derived pages change in the same PR or a
  follow-up docs PR referencing the VRS change.
- Term usage follows the root ontology; `overview/concepts` is a derived
  rendering of it.

## Information Architecture (LS.DOCS-R06)

| Section (`docs/src/content/docs/`) | Audience path |
| --- | --- |
| `overview/`, `index.mdx` | Orientation: what/why/when, concepts |
| `getting-started/`, `tutorial/` | Adoption |
| `building-with-livestore/` | Building: store, events, state, reactivity, syncing, devtools |
| `understanding-livestore/` | Depth: event sourcing, design rationale |
| `platform-adapters/`, `sync-providers/`, `framework-integrations/` | One page per realization of each pluggable dimension |
| `examples/` | Learning by example (see `01-examples/`) |
| `patterns/`, `api/`, `misc/` | Reference and cross-cutting topics |
| `sustainable-open-source/` | Derived from `06-sustainability/` and `05-contributing/` |

## Snippet Pipeline (LS.DOCS-R04)

- Snippet sources live in the snippet workspace
  `docs/src/content/_assets/code/**`; imports are relative with explicit
  extensions; no `@ts-ignore`/`as any` workarounds.
- Snippets are pre-rendered with Expressive Code Twoslash via
  `@local/astro-twoslash-code`; docs import them with `?snippet`.
- `mono docs dev|build` builds snippets and diagrams by default;
  `mono docs snippets build` renders bundles + manifest for CI; docs CI fails
  when snippets stop compiling.
- The authoritative pipeline contract is the header comment of
  `packages/@local/astro-twoslash-code/src/cli/snippets.ts`.

## Diagram Policy (LS.DOCS-R05)

- New diagrams use D2 (`...@base.d2` include); Mermaid and TLDraw remain for
  existing diagrams (`docs/src/content/_assets/diagrams/`).
- Diagram sources are versioned next to the docs content that uses them.

## Versioning Policy

The docs site tracks the latest release only; there are no per-release
snapshots (policy captured 2026-07-15; tradeoff LS.DOCS-T01).
