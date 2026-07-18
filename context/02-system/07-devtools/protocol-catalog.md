# Devtools Protocol — Message Catalog

Companion to [spec.md](./spec.md). Enumerates every message type in
`packages/@livestore/common/src/devtools/devtools-messages-{leader,client-session}.ts`
and `devtools-sessioninfo.ts`, as listed in the `MessageToApp` /
`MessageFromApp` union schemas. Hand-enumerated (2026-07-16); generating this
table from the schema union members so it cannot drift is a candidate
follow-up (see spec `LS.SYS.DT-DQ2`).

Kinds: **req-res** (single request → single response, correlated by
`requestId`), **sub-stream** (Subscribe/Unsubscribe pair → repeated `…Res`
messages correlated by `subscriptionId`), **control** (mutates engine or
sync state), **handshake** (version negotiation), **lifecycle**, **push**
(app-initiated stream without a subscribe).

## Envelope

Every message carries `liveStoreVersion` (display-only string). Leader
messages add `clientId` + `requestId`; client-session messages add
`clientId` + `sessionId` + `requestId`. `LeaderReqResMessage`-built
operations produce tag triples: `<Tag>.Request`, `<Tag>.Response.Success`,
`<Tag>.Response.Error`.

## Leader namespace (`LSD.Leader.*`)

| Tag | Direction | Kind | Purpose |
| --- | --- | --- | --- |
| `Ping` / `Pong` | ToApp / FromApp | handshake | Liveness + protocol-version check (`devtoolsProtocolVersion` optional) |
| `VersionMismatch` | FromApp | handshake | Reply when the Ping's protocol version is unsupported; carries both package and protocol versions |
| `Disconnect` | both | lifecycle | Tear down the channel; server drops subscriptions |
| `SnapshotReq` / `SnapshotRes` | ToApp / FromApp | req-res | Export the state DB as bytes (transferable) |
| `EventlogReq` / `EventlogRes` | ToApp / FromApp | req-res | Export the eventlog DB as bytes |
| `DatabaseFileInfoReq` / `DatabaseFileInfoRes` | ToApp / FromApp | req-res | File size + persistence info for state and eventlog DBs |
| `SyncingInfoReq` / `SyncingInfoRes` | ToApp / FromApp | req-res | Whether sync is enabled + backend metadata |
| `NetworkStatusSubscribe` / `NetworkStatusUnsubscribe` / `NetworkStatusRes` | ToApp / ToApp / FromApp | sub-stream | Observe network status |
| `SyncHistorySubscribe` / `SyncHistoryUnsubscribe` / `SyncHistoryRes` | ToApp / ToApp / FromApp | sub-stream | Stream synced events (global encoded + metadata) |
| `SyncHeadSubscribe` / `SyncHeadUnsubscribe` / `SyncHeadRes` | ToApp / ToApp / FromApp | sub-stream | Observe local + upstream sync heads |
| `SyncPull` | FromApp | push | Leader pushes upstream payloads to devtools (marked `TODO refactor to push/pull semantics`) |
| `CommitEventReq` / `CommitEventRes` | ToApp / FromApp | control (destructive) | Inject an event into the store; committed with origin tag `devtools-${clientId}` |
| `LoadDatabaseFile.Request` / `.Response.Success` / `.Response.Error` | ToApp / FromApp | control (destructive) | Import a database file (state or eventlog); forces client shutdown; import is not origin-attributable in the eventlog |
| `ResetAllData.Request` / `.Response.Success` | ToApp / FromApp | control (destructive) | Reset persisted data (`all-data` or `only-app-db`) |
| `SetSyncLatch.Request` / `.Response.Success` | ToApp / FromApp | control | Close/open the sync latch (simulate offline) |

Defined but absent from the unions (dead/legacy definition):
`ResetAllDataReq` (superseded by `ResetAllData.Request`).

## ClientSession namespace (`LSD.ClientSession.*`)

| Tag | Direction | Kind | Purpose |
| --- | --- | --- | --- |
| `Ping` / `Pong` | ToApp / FromApp | handshake | Liveness + protocol-version check |
| `VersionMismatch` | FromApp | handshake | Unsupported-version reply (same shape as leader variant) |
| `Disconnect` | both | lifecycle | Tear down the channel |
| `DebugInfoReq` / `DebugInfoRes` | ToApp / FromApp | req-res | Snapshot of the session `DebugInfo` struct (slow queries, etc.) |
| `DebugInfoHistorySubscribe` / `DebugInfoHistoryUnsubscribe` / `DebugInfoHistoryRes` | ToApp / ToApp / FromApp | sub-stream | Periodic `DebugInfo` history; each tick resets the wrapper's `debugInfo` (read-with-side-effect, see spec) |
| `DebugInfoResetReq` / `DebugInfoResetRes` | ToApp / FromApp | control | Explicitly reset collected debug info |
| `DebugInfoRerunQueryReq` / `DebugInfoRerunQueryRes` | ToApp / FromApp | control | Re-execute a recorded query (string + bind values + queried tables) |
| `ReactivityGraphSubscribe` / `ReactivityGraphUnsubscribe` / `ReactivityGraphRes` | ToApp / ToApp / FromApp | sub-stream | Reactivity-graph snapshots (optionally with results) |
| `LiveQueriesSubscribe` / `LiveQueriesUnsubscribe` / `LiveQueriesRes` | ToApp / ToApp / FromApp | sub-stream | Serialized live queries: tag, id, label, hash, runs, execution times, latest result, active subscriptions (stack frames) |
| `SyncHeadSubscribe` / `SyncHeadUnsubscribe` / `SyncHeadRes` | ToApp / ToApp / FromApp | sub-stream | Session view of local + upstream heads |

## SessionInfo channel (broadcast)

| Tag | Direction | Kind | Purpose |
| --- | --- | --- | --- |
| `RequestSessions` | devtools → sessions | poll | Ask all sessions to (re)announce; sent every 1s by default |
| `SessionInfo` | session → devtools | announce | Identity: storeId, clientId, sessionId, schema alias, leader flag, browser origin |
