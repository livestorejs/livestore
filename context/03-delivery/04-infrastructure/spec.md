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

### State carries no secret

Declared state is committed to the repository, so the governing rule is that
**state must contain no secret material**. This is a property to preserve, not
a compromise to tolerate: an adopt-only declaration of a write-only value
produces state describing shape alone, and non-secret attributes are public by
definition.

Encryption of the committed state is defence in depth, not the mechanism that
satisfies `LS.DEL.INFRA-R02`. Because the repository is permanent
(`LS.DEL.INFRA-A01`), encrypting a committed secret would only convert an
immediate disclosure into an offline attack against a passphrase, and a
passphrase rotation could never undo it — history keeps the ciphertext. The
requirement is met by the state being empty of secrets, and the encryption
exists so that a mistake is survivable rather than immediate.

Two consequences follow, and both are ordering rules:

- **Remote state is required before the first secret-bearing resource is
  declared, not after.** Where a resource's state would carry secret material,
  state moves out of the repository first. Afterwards is too late: the commit
  is already permanent. The intended backend is a Cloudflare R2 bucket, whose
  enablement is an account-level human action —
  [.reference/cloudflare-r2-enablement.md](./.reference/cloudflare-r2-enablement.md).
- **A resource is adopted only if its live values are not themselves secret.**
  Import writes non-secret values into state verbatim, so adopting a credential
  that a provider holds as ordinary configuration would publish it. Where a
  live resource stores a credential unprotected, it moves to the provider's
  secret mechanism *before* adoption, never after.

A rotation is a supervised act for the same reason: it writes a secret value
into state, so the resulting state is not committed.

## Provider Surfaces

| Surface | Provider | Declared |
| --- | --- | --- |
| Docs site env vars (both surfaces) | Netlify | yes |
| `livestore.dev` hand-authored DNS | Netlify (zone is Netlify-hosted) | yes |
| Docs custom domains | Netlify | yes |
| `livestore.dev` `NETLIFY`-type records | Netlify | indirectly — see below |
| Docs search index | Mixedbread | no |
| Examples hosting | Cloudflare Workers | no |
| CI runners | Namespace, GitHub-hosted | no |
| Community bot | Discord | not in this repository |

`NETLIFY`-type records are created by Netlify from each site's domain settings
and cannot be declared directly, so they are governed by owning the claims that
produce them. That indirection has a gap: a record can outlive the claim that
created it, and such a record is invisible to the drift check because the
config cannot name it —
[.reference/netlify-provider-limitations.md](./.reference/netlify-provider-limitations.md).

Closing the undeclared rows is tracked by
[.delta/DELTA-002-infrastructure-largely-undeclared.md](./.delta/DELTA-002-infrastructure-largely-undeclared.md).
