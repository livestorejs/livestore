# Web Topology — Requirements

Role: owns the browser worker graph and its wiring — main thread ⇄ shared
worker ⇄ dedicated leader worker, the port protocol between them, and the
shared worker's mediation role. Refines
[../requirements.md](../requirements.md).

## Requirements

- **LS.SYS.RT.WEB.TOPO-R01 Worker isolation:** The leader runs in a
  dedicated leader worker; a shared worker mediates between tabs and the
  leader so the main thread never blocks on persistence or sync. Re-homed
  2026-07-16 from `LS.SYS.RT.WEB-R01`. `refines: LS.SYS.RT-R01`
- **LS.SYS.RT.WEB.TOPO-R02 Encoded-payload boundary:** Only the encoded sync
  payload crosses the worker boundary; schemas travel with each worker
  bundle and are never structured-cloned (see [spec.md](./spec.md)
  §Two-Layer Initial Messages). Adopted 2026-07-16 (interview).
- **LS.SYS.RT.WEB.TOPO-R03 Mediation queueing:** Requests arriving while no
  leader is registered queue and are served by the next leader; a port swap
  drops no requests (see [spec.md](./spec.md) §Port Swap and Mediation).
  Adopted 2026-07-16 (interview).
