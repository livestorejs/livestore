# Devtools — Spec

This document specifies the devtools protocol and surface contract
(`packages/@livestore/common/src/devtools/`). It builds on
[requirements.md](./requirements.md). The full message inventory lives in
[protocol-catalog.md](./protocol-catalog.md).

## Status

Draft.

## Protocol

```
devtools surface (web channel · Expo proxy · browser extension)
   │ webmesh channel (mode: direct | proxy)
   ├── ClientSession namespace   devtools-messages-client-session.ts
   │     debug info · reactivity graph · live queries · sync head
   └── Leader namespace          devtools-messages-leader.ts
         eventlog/state export+import · sync state · reset · latches
```

- Message schemas are tagged structs (`LSD.{Leader,ClientSession}.*`) built
  by shared factories that stamp the envelope: `liveStoreVersion` on every
  message, plus `clientId`/`requestId` (leader) and
  `clientId`/`sessionId`/`requestId` (client session) (LS.SYS.DT-R01).
  Request/response operations built via `LeaderReqResMessage` produce
  `.Request` / `.Response.Success` / `.Response.Error` tag triples.

### Subscription/streaming model

Most traffic is not request/response but subscription lifecycles: a
`…Subscribe` message carrying a devtools-chosen `subscriptionId` starts a
server-pushed stream of `…Res` messages tagged with that id; `…Unsubscribe`
ends it. Handlers keep per-subscription fibers in a `FiberMap` keyed by
`subscriptionId` and drop all subscriptions on `Disconnect`. Response
messages mint fresh `nanoid` request ids.

### Delivery semantics

Channel delivery is at-least-once: webmesh proxy channels can double-deliver
(observed on Expo). Both endpoints therefore keep a `handledRequestIds` dedup
set and ignore repeats; unsubscribe paths tolerate stale ids from prior
channel incarnations (`?.()` guards). Handlers must stay idempotent under
duplicate delivery. Moving dedup into the webmesh layer is a code TODO.

### Versioning and compatibility

- Two version fields: `liveStoreVersion` (required on every message,
  display-only package version) and `devtoolsProtocolVersion` (optional,
  handshake-only; absent ⇒ protocol 1 for legacy peers).
- Compatibility is decided only at the `Ping` handshake:
  `isDevtoolsProtocolVersionSupported` checks membership in
  `supportedDevtoolsProtocolVersions` — currently the single-element list
  `[1]`. An unsupported version is answered with a `VersionMismatch` message
  (carrying both package and protocol versions) instead of a `Pong`, and the
  request is not processed; the channel is not closed and non-handshake
  messages are not version-gated (LS.SYS.DT-R02).

### Session discovery

Sessions announce a `SessionInfo` (store/client/session ids, schema alias,
leader flag, browser origin) once on connect; devtools poll with
`RequestSessions` every 1s (default) and each session re-announces on every
poll. Devtools evict entries not re-seen within a 5s stale timeout
(`devtools-sessioninfo.ts`). Discovery is poll + TTL eviction, not a push
registry: a dead session disappears within the stale window
(LS.SYS.DT-R06). Channel and node names follow `Devtools.makeNodeName.*` /
`isChannelName.*`; channels are origin-scoped in browsers.

### Channel modes

`mode: direct | proxy` is fixed at devtools boot and endpoints only accept
channels whose mode matches (`res.mode === mode`). `direct` is the
same-origin web path (MessagePort-backed); `proxy` is the hop-routed webmesh
path used by out-of-process surfaces (Expo devtools). This is the
web-vs-contrib fork in one flag.

### Control operations

All state-mutating operations are explicit protocol messages
(LS.SYS.DT-R04):

| Operation | Effect | Attribution |
| --- | --- | --- |
| `ResetAllData` | wipe persisted data (`all-data` / `only-app-db`) | implicit (shutdown broadcast) |
| `LoadDatabaseFile` | import a state/eventlog DB, forces shutdown | **not** origin-tagged in the eventlog |
| `CommitEventReq` | inject an event into the store | committed with origin `devtools-${clientId}` |
| `SetSyncLatch` | close/open sync latch (simulate offline) | n/a (transient) |
| `DebugInfoResetReq` | clear collected debug info | n/a (diagnostic state) |

Known wart: `DebugInfoHistorySubscribe` *reads with a side effect* — each
tick resets `sqliteDbWrapper.debugInfo` to empty, starving any other reader
of the same struct (code TODO; issue #1421).

## Surfaces

| Surface | Home | Transport | Status |
| --- | --- | --- | --- |
| Web channel | `adapter-web` `./devtools-web-channel` | webmesh `direct` | in-repo |
| Browser extension | `adapter-web` client-session bridge | window `postMessage` contentscript bridge into webmesh | in-repo |
| Devtools UI | separate artifact pipeline (`../../03-delivery/`) | consumes the above | external artifact |
| Expo devtools | contrib | webmesh `proxy` | stub pending LS-DQ2 |

Web discovery also probes `fetch('/_livestore')` + a
`<meta name="livestore-devtools">` tag and sniffs for the Chrome-extension
iframe; the extension download URL is pinned to the running
`liveStoreVersion`.

## Relationship to observability

Devtools inspection does not consume the OTel telemetry from
[../06-observability/](../06-observability/spec.md) today — it reads a
parallel introspection surface (`DebugInfo`, query execution times,
reactivity-graph snapshots) with no span/trace linkage. Converging the two
(e.g. devtools rendering LiveStore spans) is an open direction, not current
behavior.

## Open Design Questions

- **LS.SYS.DT-DQ1 Protocol evolution.** Version bumps are all-or-nothing;
  whether per-message capability negotiation is needed before the UI kit
  (roadmap) externalizes consumers is undecided.
- **LS.SYS.DT-DQ2 Generated catalog.** [protocol-catalog.md](./protocol-catalog.md)
  is hand-enumerated; generating it from the `MessageToApp`/`MessageFromApp`
  union members (freshness-gated) would remove drift risk.
