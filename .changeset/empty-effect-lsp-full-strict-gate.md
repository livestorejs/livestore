---
---

No release impact. CI-contract change (#811 capstone): remove LiveStore's temporary errors-only Effect-LSP override in `genie/repo.ts` so the inherited effect-utils `effectDiagnosticsGate` applies in full — Effect warnings AND suggestions (not just errors) now fail `tsgo --build`. Regenerates the 28 package tsconfigs to the full gate. Clears the diagnostics this surfaces: a `globalErrorInEffectFailure:off` on the synthetic shutdown-failure signal in the ClientSessionSyncProcessor test, and the snapshot-release validation/IO failures in `scripts/src/commands/release.ts` (from #1458) rerouted through the existing `ReleaseError` tagged error. Behavior-neutral.
