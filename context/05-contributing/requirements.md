# Contributing — Requirements

Role: owns how the project accepts contributions and governs change — scope
boundaries, the RFC proposal pipeline and its fold-in rule, governance, and
the security-reporting policy. Day-to-day collaboration mechanics live in
[01-collaboration/](./01-collaboration/requirements.md); public community
surfaces live in [02-community/](./02-community/requirements.md).

## Context

Builds on the root [requirements.md](../requirements.md) and
[decision 0002](../.decisions/0002-single-intent-layer.md). Grounded in
`CONTRIBUTING.md` and `contributor-docs/rfcs/index.md` (both become derived/
absorbed surfaces per root DELTA-001).

## Requirements

### Proposal pipeline

- **LS.CONTRIB-R01 RFC gate:** Significant changes to public APIs or core
  architecture are proposed as RFCs before implementation.
- **LS.CONTRIB-R02 Fold-in rule:** When an RFC is accepted, its durable content
  is folded into the owning VRS nodes (requirements/spec clauses; choices and
  rejected alternatives as decision records citing the RFC). Any accepted
  contract that is not yet implemented is represented by a `.delta/` record
  with an explicit close condition; each delta is closed as the implementation
  and its required evidence land. The RFC then becomes a historical record and
  is never updated to track reality. `refines: LS-R15`

### Contribution workflow

- **LS.CONTRIB-R03 Pre-coordination:** Non-trivial contributions are checked
  with maintainers before implementation (Discord `#contrib`).
- **LS.CONTRIB-R04 Scope tiers:** The project publishes and maintains
  explicit contribution tiers — encouraged, potentially in scope, and out of
  scope.
- **LS.CONTRIB-R05 Changeset per PR:** Every pull request includes a
  changeset (empty when the change has no release-note impact).
- **LS.CONTRIB-R06 Reproducible bug reports:** Bug reports include a minimal
  reproducible example.

### Security

- **LS.CONTRIB-R09 Vulnerability reporting channel:** Security
  vulnerabilities have a documented private reporting channel (GitHub
  Security Advisories), realized by the repo-root `SECURITY.md`; security
  fixes target the latest release line. Adopted 2026-07-16 (interview).

### Governance

- **LS.CONTRIB-R07 Review principles:** Review judgment follows the
  published guiding principles: keep it simple, reduce surface area, make
  the right thing easy, document the why.
- **LS.CONTRIB-R08 Sustainable maintainership:** The project is maintained
  without a company; maintainer roles (e.g. wa-sqlite build, examples,
  framework integrations) can be held by community members.
  `refines: LS-A05`
