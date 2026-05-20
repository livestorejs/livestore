This document specifies the LiveStore DevTools artifact release contract. It is a spec-only VRS document for the release subsystem and is constrained by the workflow documentation in [../../.github/workflows/README.md](../../.github/workflows/README.md).

## Status

Active.

## Scope

This spec defines:

- how LiveStore releases consume DevTools artifacts
- when `overeng` is required
- which release scenarios must remain supported
- the simpler long-term certification model

This spec does not define:

- DevTools runtime protocol semantics
- npm package publishing credentials
- Chrome Web Store publication

## Release Boundary

```
overeng source
  -> DevTools artifact producer
  -> immutable public artifact
  -> release/devtools-artifact.json
  -> LiveStore release CI
  -> @livestore/devtools-vite + Chrome ZIP repack
```

`overeng` owns DevTools source and artifact production. LiveStore owns the
release decision for artifacts shipped under LiveStore versions.

The checked-in artifact pointer is long-lived state. Compatibility proof is
release-candidate state.

## Cadence Invariant

LiveStore releases must not require `overeng` work when the selected DevTools
artifact is still compatible.

This invariant is intentional because LiveStore releases happen more often than
DevTools releases. A normal LiveStore release should download the pinned
artifact, verify its integrity, run release-candidate compatibility checks, and
publish the repacked DevTools package if those checks pass.

`overeng` is required only when:

- DevTools source changes
- the selected artifact fails LiveStore release-candidate compatibility checks
- the artifact metadata or packaging contract changes
- a coupled LiveStore and DevTools protocol change is intentional

## Release Scenarios

| Scenario | Requires `overeng`? | Expected behavior |
| --- | --- | --- |
| LiveStore release with unchanged DevTools | No | LiveStore CI re-verifies the pinned artifact against the release candidate. |
| LiveStore patch release | No | The pinned artifact is reused if the compatibility gate passes. |
| DevTools-only artifact refresh | Yes | `overeng` builds and publishes a new immutable artifact, then LiveStore reviews the manifest update. |
| Coupled LiveStore and DevTools change | Yes | A new artifact is produced for the LiveStore change and LiveStore CI verifies that exact pairing. |
| Existing artifact fails compatibility | Usually yes | Release blocks until LiveStore preserves compatibility or a new DevTools artifact is produced. |
| CI snapshot release | No | Snapshot repack may use ephemeral CI certification because snapshot versions cannot be checked in ahead of time. |

## Certification Model

The release model does not store LiveStore-version-specific certification as
durable repository state.

Durable state:

```json
{
  "artifact": {
    "metadataUrl": "...",
    "tarballUrl": "...",
    "sha256": "...",
    "chromeZipUrl": "...",
    "chromeZipSha256": "..."
  }
}
```

Ephemeral CI proof:

```json
{
  "livestoreVersion": "0.4.0-dev.27",
  "devtoolsBuildId": "dt-...",
  "devtoolsProtocolVersion": 1,
  "scenarios": [
    "node adapter session loads through Vite and stays connected past 35 seconds"
  ],
  "ciRunUrl": "https://github.com/livestorejs/livestore/actions/runs/..."
}
```

Release publish should depend on the CI proof for the release candidate, not on
manual certification text committed to the manifest.

## Compatibility Gate

LiveStore release CI must verify:

- artifact checksums match the manifest
- metadata declares a supported DevTools protocol version
- repacked package shape is valid
- the artifact does not leak source, sourcemaps, credentials, or local paths
- node adapter direct-route liveness survives the heartbeat window

The release artifact liveness scenario must use the exact downloaded artifact,
not a local workspace build. The Node adapter scenario must replace every workspace
`@livestore/devtools-vite` resolution path used by the fixture, including the
transitive package under `@livestore/adapter-node`; replacing only the test
package's top-level `node_modules` entry is not sufficient proof.

Direct web session liveness is still required in the normal Playwright DevTools
suite, but it is not claimed as exact-artifact release proof because it does not
exercise the repacked `@livestore/devtools-vite` artifact selected by the
LiveStore manifest.

The liveness scenario must also be independent of developer-machine sponsor
activation state. Public DevTools artifacts enforce the sponsor/license gate by
default, but release certification runs with the explicit
`LIVESTORE_DEVTOOLS_ENFORCE_LICENSE=false` test override so CI verifies
connectivity and protocol compatibility rather than a maintainer's local
license cache.

## Simplification

The durable state is intentionally limited to immutable artifact identity:

1. keep only immutable artifact identity in `release/devtools-artifact.json`
2. run compatibility certification during LiveStore release validation
3. publish only from the same release candidate that passed certification
4. require `overeng` only to produce or replace artifacts

This preserves the original safety property without making every LiveStore
release a DevTools release.

## Documentation Contract

LiveStore docs must document consumer behavior and release scenarios.

`overeng` docs must document producer behavior:

- how DevTools artifacts are built
- how artifact metadata is generated
- how artifact checksums are produced
- how a LiveStore manifest update is requested
- how to debug producer-side certification failures

Docs must be updated whenever the release boundary, artifact schema, or required
compatibility scenarios change.
