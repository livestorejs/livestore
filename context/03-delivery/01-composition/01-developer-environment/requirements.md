# Developer Environment — Requirements

Role: `01-developer-environment/` owns shell readiness and the diagnostic
contract for setup work. It refines the broader tooling-composition outcome in
[../requirements.md](../requirements.md).

## Requirements

- **LS.DEL.COMP.DEV-R01 Readiness before validation:** Entering the supported
  development shell establishes dependency and generated-source readiness
  without requiring full source validation. TypeScript build and check tasks
  remain explicit developer and CI gates. `refines: LS.DEL.COMP-R18`
