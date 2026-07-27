# Infrastructure — Spec

This document specifies how LiveStore's third-party infrastructure is declared
and how its credentials are handled. It builds on
[requirements.md](./requirements.md).

## Status

Draft.

## Declared-State Layout (LS.DEL.INFRA-R01)

Declared state lives under `.infra/iac/<provider>/`, one directory per provider
account, written in OpenTofu (HCL). A provider directory owns the resources of
exactly one account, so account boundaries are visible in the tree rather than
encoded in configuration.

Operator entry points are devenv tasks, never bare `tofu` invocations, so that
credential injection cannot be skipped:

- `dt infra:<provider>:plan` — read-only; reports drift between declared and
  live state.
- `dt infra:<provider>:apply` — converges live state onto the declaration.

## Ownership Model — Adopt, Never Recreate (LS.DEL.INFRA-R04)

Resources that already exist are brought under declared state by import, not by
creation. The acceptance signal for an adoption is a `plan` that reports no
changes: the declaration matches reality exactly, so ownership transfers without
a write to the live system.

Declarations are scoped to the narrowest resource that expresses the intent. A
configuration that manages a site's environment variables declares only those
variables and refers to the site by literal identifier — it does not declare the
site, and does not read it through a data source. This makes disruption of the
surrounding resource structurally impossible rather than merely unlikely.

Where a provider treats a value as write-only — accepted on write, never
returned on read — the declaration owns the resource's *shape* (existence,
scopes, contexts) and not its value. Shape drift is still detected; the value is
governed by `LS.DEL.INFRA-R03` instead. See
[.decisions/0001-netlify-env-iac.md](./.decisions/0001-netlify-env-iac.md).

## Secret Handling (LS.DEL.INFRA-R02, LS.DEL.INFRA-R03)

Credential values are resolved from 1Password at run time and injected as
process environment, never read from a file in the working tree. Declarations
reference secrets by variable, so the configuration is complete and reviewable
without containing a secret.

Because the repository is public and permanent (`LS.DEL.INFRA-A01`), the
constraint is on what is *committed*, not on what is *readable at rest*:
encryption of a committed artifact converts an immediate disclosure into an
offline attack against the passphrase, which `LS.DEL.INFRA-R02` does not accept
as sufficient. Remote state — a bucket outside the repository — is the intended
mechanism. The current deviation is tracked in
[.delta/DELTA-001-state-ciphertext-committed.md](./.delta/DELTA-001-state-ciphertext-committed.md).

A rotation is a supervised act: it re-introduces a secret value into state, so
the resulting state must not be committed while
[DELTA-001](./.delta/DELTA-001-state-ciphertext-committed.md) is open.

## Provider Surfaces

| Surface | Provider | Declared |
| --- | --- | --- |
| Docs site hosting | Netlify (`livestore-docs`) | env vars only |
| Docs search index | Mixedbread | no |
| Examples hosting | Cloudflare Workers | no |
| `livestore.dev` DNS | Cloudflare | no |
| CI runners | Namespace, GitHub-hosted | no |
| Community bot | Discord | not in this repository |

Closing the undeclared rows is tracked by
[.delta/DELTA-002-infrastructure-largely-undeclared.md](./.delta/DELTA-002-infrastructure-largely-undeclared.md).
