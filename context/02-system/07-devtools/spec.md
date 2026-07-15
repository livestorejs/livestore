# Devtools — Spec

This document specifies the devtools protocol and surface contract
(`packages/@livestore/common/src/devtools/`). It builds on
[requirements.md](./requirements.md).

## Status

Draft.

## Protocol

```
devtools surface (e.g. web channel)
   │ webmesh channel (mode: direct | proxy)
   ├── ClientSession namespace   devtools-messages-client-session.ts
   │     MessageToApp / MessageFromApp  (queries, reactivity, disconnect)
   └── Leader namespace          devtools-messages-leader.ts
         MessageToApp / MessageFromApp  (eventlog, sync state, reset,
                                         network latches)
```

- Message schemas are tagged structs in `devtools-messages-*.ts`; the
  `ClientSession` and `Leader` namespaces are the two endpoints
  (LS.SYS.DT-R01).
- Compatibility: handshake carries a devtools protocol version; support is
  decided by `isDevtoolsProtocolVersionSupported` — an unversioned legacy
  ping resolves to protocol 1 (`devtools-compatibility.test.ts`,
  LS.SYS.DT-R02). The `liveStoreVersion` string in messages is display-only.
- Session discovery: sessions broadcast `SessionInfo` (store/client/session
  ids, schema alias, leader flag, origin) on a broadcast channel; channel and
  node names follow `Devtools.makeNodeName.*` / `isChannelName.*`
  (LS.SYS.DT-R06). Channels are origin-scoped in browsers.
- Control paths: `sendDevtoolsMessage` on the leader proxy; session
  pull/push latches simulate offline (LS.SYS.DT-R04).

## Surfaces

| Surface | Home | Status |
| --- | --- | --- |
| Web channel | `adapter-web` `./devtools-web-channel` | in-repo |
| Devtools UI | separate artifact pipeline (`../../03-delivery/`) | external artifact |
| Expo devtools | contrib | stub pending LS-DQ2 |

## Open Design Questions

- **LS.SYS.DT-DQ1 Protocol evolution.** Version bumps are all-or-nothing;
  whether per-message capability negotiation is needed before the UI kit
  (roadmap) externalizes consumers is undecided.
