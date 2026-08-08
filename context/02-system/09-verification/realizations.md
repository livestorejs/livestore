# Composed-System Verification Realizations — Registry

Known realizations of composed-system verification
([LS.SYS.VER-R08](./requirements.md)). Referencing follows
[decision 0003](../../.decisions/0003-contrib-referencing.md): core records
the realization and its home, while contrib owns its detailed intent and
implementation specification.

| Realization | Home | Contract relationship |
| --- | --- | --- |
| Scenario runner and viewer | [contrib `tests/scenarios`](https://github.com/livestorejs/livestore-contrib/tree/main/tests/scenarios) · [contrib intent](https://github.com/livestorejs/livestore-contrib/tree/main/context/verification/scenarios) | Refines `LS.SYS.VER-R08`; `LSC.*` requirements, decisions, and tracked gaps are contrib-owned |

The registry is a discovery surface, not a definition of the runner, trace,
artifact, oracle, or visualization design.
