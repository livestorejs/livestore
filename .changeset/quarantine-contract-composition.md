---
---

No release impact. The only file touched under `packages/` is
`packages/@livestore/wa-sqlite/flake.nix`, reformatted by `nixfmt` because this change adopts
effect-utils' `lint-nix` module and `lint:nix:format` became a required check. The vendored
fork's build is unaffected — formatting only, no expression changes.

The substantive change is CI-side: the test-quarantine mechanism now composes over
`ci-tools quarantine` (overengineeringstudio/effect-utils#971) instead of reimplementing the
entry schema, expiry rule, and announcement locally. No published package behavior changes.
