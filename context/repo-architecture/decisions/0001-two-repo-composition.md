# Two-repo architecture — key decisions

This ADR records the durable decisions behind the LiveStore core/contrib
repository architecture.

## Asymmetric Megarepo Composition

Core records contrib unpinned; contrib records core pinned.

| Option                             | Rejected because                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------ |
| Bidirectional pinned locks         | Every push in either repo forces a coordinated lock bump in the other                |
| No core -> contrib member          | Core's docs build still needs contrib source, and `mr` is the shared fetch mechanism |
| Custom shallow clone in docs build | Introduces a second cross-repo fetch pattern                                         |

The asymmetric graph lets contrib test against deterministic core source while
core docs can read current contrib source without creating a lock ratchet.

## Workspace Links During Development

Contrib consumes core through pnpm workspace links over the materialized
`repos/livestore` symlink.

| Option                                    | Rejected because                                         |
| ----------------------------------------- | -------------------------------------------------------- |
| Published npm versions during development | Contrib can drift silently from core source              |
| npm in CI, workspace locally              | Adds environment divergence and keeps both failure modes |

The materialized checkout must be writable because pnpm can write
`node_modules` into resolved workspace package directories.

## Exact Lockstep Versions At Publish

Contrib mirrors core's version stamp and rewrites `workspace:*` dependencies to
exact versions during publish.

| Option                       | Rejected because                                           |
| ---------------------------- | ---------------------------------------------------------- |
| Independent contrib versions | Users lose the simple "same version tested together" model |
| Version ranges for core deps | Published graphs become non-deterministic                  |

Lockstep releases cost extra publish events, but remove ambiguity from the
package graph.

## Relative Shared Helper Imports

Contrib imports core shared helpers through `../repos/livestore/...`, not
`#mr/livestore/...`.

`#mr` specifiers resolve against the file's own megarepo root. Relative imports
enter core's source tree first, allowing core's internal `#mr/effect-utils/...`
imports to resolve against core's materialized members.

Core does not own the final contrib package or example manifest. Core exports
core package metadata and reusable generator helpers; contrib owns its local
package/example membership and composes that with materialized core package
metadata. This avoids making every contrib package-set change a core PR while
still keeping shared tooling centralized.

## `framework-toolkit` Stays Core-Owned

`@livestore/react` imports `framework-toolkit`, and React is core-owned. Moving
`framework-toolkit` would either break React or force an unrelated refactor.

`framework-toolkit` is therefore a shared core primitive consumed by contrib
framework packages through workspace links during development and exact
published versions at release time.

## Docs Source Ownership Can Lag Package Ownership

The public docs site remains core-owned. Contrib package docs source can stay in
the core docs tree while package source and TypeDoc entry points move to
contrib.

This keeps docs-source ownership separate from the repository composition
contract. The eventual docs-source move can happen without changing
`docs.livestore.dev`.
