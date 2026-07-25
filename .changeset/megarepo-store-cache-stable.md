---
---

No release impact. Experiment (#1480): cache the megarepo store at a STABLE path so the actions/cache version is stable across runs and restores actually hit (the run-scoped default path made each run a unique cache version →always misses). Overrides the sync step's `MEGAREPO_STORE` to `${{ runner.temp }}/megarepo-store` and adds restore/save cache steps keyed on `megarepo.lock`.
