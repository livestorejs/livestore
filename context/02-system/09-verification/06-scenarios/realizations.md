# Scenario Verification Realizations — Registry

All realizations of the Scenario verification contract
([spec.md](./spec.md)). The referencing mechanism follows
[root decision 0003](../../../.decisions/0003-contrib-referencing.md).

| Realization | Home | Contract status |
| --- | --- | --- |
| Headless runner and live/replay viewer | [`livestore-contrib`](https://github.com/livestorejs/livestore-contrib) · implementation intent: contrib `context/verification/scenarios/` | migration in progress; must refine `LS.SYS.VER.SCEN-*` |

Core owns no in-repository Scenario realization. Profile, backend, corpus,
artifact, UI, and implementation-gap detail belongs to the contrib intent node;
only reusable LiveStore package seams and their focused tests remain here.
