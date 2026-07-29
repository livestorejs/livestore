# Contributing — Spec

This document specifies the contribution and governance model. It builds on
[requirements.md](./requirements.md).

## Status

Draft.

## Scope

Defines: the RFC lifecycle, contribution scope tiers, and governance shape.
Does not define day-to-day mechanics (branches, changelogs, review flow) —
see [01-collaboration/](./01-collaboration/spec.md).

## RFC Lifecycle (LS.CONTRIB-R01, R02)

```
draft ──► review PR ──► accepted (PR merged) ──► implemented
                                                     │
                                              fold-in to VRS
                                                     │
                                            RFC = historical record
```

1. **Draft** — copy `contributor-docs/rfcs/0000-template.md` to the next
   sequential number. Required sections: Context (facts), Problem, Proposed
   Solution, Alternatives Considered, Open Questions.
2. **Review** — open a PR, gather feedback, iterate until consensus.
3. **Accept** — merge the PR; implementation may begin.
4. **Fold in** (normative addition per decision 0002) — with the landed
   implementation, move durable content into the owning VRS nodes; record
   the choice and rejected alternatives as `.decisions/` entries citing the
   RFC. The published RFC process description includes this step
   (`contributor-docs/rfcs/index.md` §4, added 2026-07-16).

Current RFC state: RFC 0001 (multi-store API) is shipped and folded into
[`02-system/05-store/`](../02-system/05-store/spec.md) — whose spec records
where the implementation diverged from the proposal (e.g. `dispose()` vs the
RFC's `clear()`, longest-wins cache-time); the RFC is retained as a historical
record. RFC 0002 (command replay) is an active proposal (root LS-DQ1).

## Contribution Scope Tiers (LS.CONTRIB-R04)

| Tier | Content (today) |
| --- | --- |
| Help wanted | wa-sqlite build maintainer, examples maintainer, Solid integration maintainer; `help wanted` issues |
| Encouraged | Docs improvements, examples, test cases, bug fixes, benchmarking |
| Potentially in scope | New features, larger core changes (RFC first), new integrations, monorepo/docs-site changes |
| Out of scope (for now) | Landing page, devtools, core rewrite in another language |

## Security Policy (LS.CONTRIB-R09)

Vulnerabilities are reported privately via GitHub Security Advisories on
`livestorejs/livestore`; the repo-root `SECURITY.md` is the public statement
of the channel. Response is maintainer best-effort; fixes target the latest
release line only (consistent with LS.DOCS-T01 latest-only docs). Decided
2026-07-16 (interview).

## Governance (LS.CONTRIB-R07, R08)

- BDFL governance: the project creator holds final decision authority
  (captured 2026-07-15). Community maintainer roles exist for named areas;
  coordination via Discord (`#contrib`) and GitHub.
- Review judgment applies the guiding principles from `CONTRIBUTING.md`.

## Open Design Questions

- **LS.CONTRIB-DQ1 Governance formality.** BDFL is the current model; a
  documented model for maintainer rights, decision escalation, and bus-factor
  mitigation becomes necessary as the maintainer count grows. Blocked on:
  that growth actually happening.
