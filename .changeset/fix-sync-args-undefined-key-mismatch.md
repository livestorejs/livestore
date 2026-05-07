---
"@livestore/common": patch
---

Fix sync hash mismatch when event args use `Schema.UndefinedOr` or loose `Schema.optional` and the field is omitted at commit time. The local pending event encoded as `{ ..., flag: undefined }` no longer compares unequal to the same event JSON-roundtripped through the sync provider as `{ ... }`. Without this fix, the merge falsely took the rebase path and state-dependent materializers re-ran on already-mutated state, surfacing as `MaterializerHashMismatchError` (#1217).
