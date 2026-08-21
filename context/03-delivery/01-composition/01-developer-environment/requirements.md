# Developer Environment — Requirements

Role: `01-developer-environment/` owns shell readiness and the diagnostic
contract for setup work. It refines the broader tooling-composition outcome in
[../requirements.md](../requirements.md).

## Requirements

- **LS.DEL.COMP.DEV-R01 Readiness before validation:** Entering the supported
  development shell establishes dependency and generated-source readiness
  without requiring full source validation. TypeScript build and check tasks
  remain explicit developer and CI gates. `refines: LS.DEL.COMP-R18`
- **LS.DEL.COMP.DEV-R02 Two supported lanes:** A fresh exclusive checkout must
  offer both a portable development lane that does not require Nix, devenv, or
  megarepo tooling and a full hermetic lane for repository-wide maintenance.
  `refines: LS.DEL.COMP-R18`
- **LS.DEL.COMP.DEV-R03 Portable TypeScript loop:** The portable lane must
  perform a frozen dependency install, reference-aware TypeScript build,
  stable core unit suite, representative Vite application build, local
  Cloudflare Worker build, and docs source check with repository-pinned
  JavaScript tooling. `refines: LS.DEL.COMP-R18`
- **LS.DEL.COMP.DEV-R04 Explicit escalation boundary:** Browser tests, the full
  docs build, generated-source regeneration, wa-sqlite rebuilding, release
  operations, and infrastructure validation must direct developers to the
  full lane rather than silently weakening those checks. `refines: LS.DEL.COMP-R18`
- **LS.DEL.COMP.DEV-R05 Independent cold-start gate:** Pull-request validation
  must exercise the portable lane from a stock hosted environment without
  first preparing Nix, devenv, or megarepo state. `refines: LS.DEL.COMP-R18`
- **LS.DEL.COMP.DEV-R06 Interactive checkout ownership:** The portable
  interactive environment must bind one exclusive checkout, preserve the
  caller's numeric ownership by default, and avoid prescribing application
  ports that belong to individual examples. `refines: LS.DEL.COMP-R18`
