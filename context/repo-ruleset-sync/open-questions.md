# Ruleset reconciliation — Open questions

## OQ1 — Decouple snapshot publishing from the whole `ci` conclusion

Removing the hard ruleset drift-gate (spec: Gate removal) stops *this* governance
job from wedging releases, but snapshot publishing is still gated on the entire
`ci` run concluding `success` (`release.yml` `publish-snapshot-version` `if:
workflow_run.conclusion == 'success'`). Any future required job that fails for
non-release reasons would still block snapshots. A durable fix gates the snapshot
job on the specific build/test jobs rather than whole-workflow conclusion, or
publishes on an independent trigger.

Status: **open** — out of scope for the ruleset-reconcile change; recommended as
a follow-up. Not blocked.

## OQ3 — Parameterize the repo target for contrib enrollment

`scripts/src/commands/github.ts` hardcodes `OWNER = 'livestorejs'` /
`REPO = 'livestore'`, so `mono github rulesets sync|check|plan` only targets
core. Topology A (one shared App across both repos) requires contrib's
genie-composed tooling to target `livestore-contrib` — i.e. the owner/repo must
be parameterized (env or flag) before contrib can enroll. `mono github app check`
is App-level (`GET /app`) and already repo-agnostic. Not needed for the core
rollout; required at contrib-enrollment time.

Status: **open** — deferred to contrib enrollment. Not blocked.

## OQ2 — Alchemy `GitHub.App` adoption

If [alchemy-run/alchemy#843](https://github.com/alchemy-run/alchemy/issues/843)
ships a `GitHub.App` resource, the manifest-as-spec + custom drift-check can be
replaced by a real Alchemy resource with read/diff built in.

Status: **blocked** on upstream #843.
