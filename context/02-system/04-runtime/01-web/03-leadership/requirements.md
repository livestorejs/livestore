# Web Leadership — Requirements

Role: owns leader election, handover, and death detection in the browser —
the two Web Locks, blocking followership, and shutdown propagation. Refines
[../requirements.md](../requirements.md).

## Requirements

- **LS.SYS.RT.WEB.LEAD-R01 Lock-coordinated leadership:** Every tab is a
  client session of the same client; leadership and shared-worker liveness
  are coordinated through the Web Locks API so tab close/crash triggers
  handover. Re-homed 2026-07-16 from `LS.SYS.RT.WEB-R02`.
  `refines: LS.SYS.RT-R04`
- **LS.SYS.RT.WEB.LEAD-R02 Cooperative election:** The tab lock is never
  stolen; election is blocking, so exactly one leader exists per client and
  no committed events are dropped across transitions (see
  [spec.md](./spec.md) §The Two Locks). Adopted 2026-07-16 (interview).
  `refines: LS.SYS.RT-R04`
- **LS.SYS.RT.WEB.LEAD-R03 Lock-release death detection:** Leader and
  shared-worker death are detected solely via Web Lock release semantics —
  no heartbeat (see [spec.md](./spec.md) §Death Detection). Adopted
  2026-07-16 (interview).
