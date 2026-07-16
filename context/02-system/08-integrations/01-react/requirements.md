# React Integration — Requirements

The React realization of the integration contract: hooks over the Store with
registry-based lifecycle. Refines [../requirements.md](../requirements.md)
(`LS.SYS.INT-*`).

## Requirements

- **LS.SYS.INT.REACT-R01 Hooks surface:** The integration exposes `useStore`,
  `useQuery`, `useClientDocument`, and `useSyncStatus`; components never touch
  session or leader internals. `refines: LS.SYS.INT-R01`
- **LS.SYS.INT.REACT-R02 Context-scoped registry:** Stores resolve through
  `StoreRegistryContext`; providers scope which stores a subtree sees.
  `refines: LS.SYS.INT-R03`
- **LS.SYS.INT.REACT-R03 StrictMode-safe resources:** Subscriptions and store
  acquisitions are reference-counted so StrictMode double-invocation and
  concurrent rendering cause no leaks or duplicate boots.
  `refines: LS.SYS.INT-R05`
- **LS.SYS.INT.REACT-R04 Consistent update delivery:** Every update delivered
  to React reflects a complete commit (the engine refreshes atomically), and
  identical results are deduplicated before triggering a re-render. The
  binding reads from mutable refs rather than `useSyncExternalStore`, so
  tear-freedom under concurrent rendering is not guaranteed by construction
  and is currently unverified (see [spec.md](./spec.md) §Subscription
  Model). `refines: LS.SYS.INT-R04`
