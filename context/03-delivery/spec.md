# Delivery — Spec

This document specifies the delivery boundary: how `livestorejs/livestore`
and `livestorejs/livestore-contrib` present one package family, and which
child node owns which delivery mechanic. It builds on
[requirements.md](./requirements.md).

## Status

Draft — the composition and artifact contracts in the children are active.

## Scope

Defines: the delivery identity (one npm scope, one docs URL, two
repositories) and the child-node ownership map.

Does not define: composition/lock mechanics
([01-composition](./01-composition/spec.md)), release/version flow
([02-release](./02-release/spec.md)), artifact flows
([03-artifacts](./03-artifacts/spec.md)), internal package architecture
(`../02-system/`), contributor governance (`../05-contributing/`), or
docs-site content rules (`../04-docs/`).

## Delivery Identity

Users see one product: every package is `@livestore/<name>` (LS.DEL-R01),
import paths never change when a package moves repositories (LS.DEL-R02),
and `docs.livestore.dev` documents the whole family. Which repository owns
which package — and everything that follows from that split — is
`01-composition/`'s contract.

## Children

| Child | Owns |
| --- | --- |
| [01-composition](./01-composition/spec.md) | Repository topology, package ownership, megarepo/lock semantics, dev-time dependency resolution, shared tooling/CI composition, docs-site composition, routing, history preservation |
| [02-release](./02-release/spec.md) | Versioning, publish flow, lockstep core→contrib releases, publish-time dependency rewriting, dependency-update policy |
| [03-artifacts](./03-artifacts/spec.md) | DevTools artifact release contract, wa-sqlite vendoring |

Decision records for the whole branch stay in [.decisions/](./.decisions/):
[0001 two-repo composition](./.decisions/0001-two-repo-composition.md),
[0002 devtools artifact cadence](./.decisions/0002-devtools-artifact-cadence.md).
