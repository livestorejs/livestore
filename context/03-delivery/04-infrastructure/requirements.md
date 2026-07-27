# Infrastructure — Requirements

Role: owns which third-party providers and accounts LiveStore depends on, how
their desired state is declared, and how credentials are handled. Deploy
*mechanics* stay with [02-release](../02-release/requirements.md) (`LS.DEL.REL-*`);
what the docs site must operationally serve stays with
[04-docs/03-operations](../../04-docs/03-operations/requirements.md); the
Cloudflare sync-backend design stays with
[02-system/03-sync/03-cf](../../02-system/03-sync/03-cf/requirements.md). This
node answers "who owns the account and where does its configuration live", not
"how does a deploy run".

## Context

Builds on the parent [requirements.md](../requirements.md). Grounded in
`.infra/iac/`, `.github/workflows/` (Namespace-hosted runners, Netlify docs
deploy, Cloudflare Workers example deploys), and the `dt infra:*` devenv tasks.

These requirements describe the target state. Today only the `livestore-docs`
Netlify environment variables are declared; the gap is tracked in
[.delta/DELTA-002-infrastructure-largely-undeclared.md](./.delta/DELTA-002-infrastructure-largely-undeclared.md).

## Assumptions

- **LS.DEL.INFRA-A01 Public repository:** `livestorejs/livestore` is
  world-readable in perpetuity, including full git history. Anything committed
  is published permanently and cannot be retracted.

## Requirements

- **LS.DEL.INFRA-R01 Declared infrastructure:** Every third-party resource
  LiveStore depends on — hosting, DNS, CI runners, provider environment
  variables, bots — is described as declared state in-repo, and changes to it
  are reviewable in a PR. Adopted 2026-07-27 (interview).
- **LS.DEL.INFRA-R02 No recoverable secrets in-repo:** No committed artifact
  contains a secret recoverable by a reader, including ciphertext whose secrecy
  rests only on a passphrase. `refines: LS.DEL.INFRA-A01` Adopted 2026-07-27
  (interview).
- **LS.DEL.INFRA-R03 One canonical secret source:** 1Password holds every
  credential value; provider environment variables and CI secrets are
  projections of it, never independent originals. Adopted 2026-07-27
  (interview).
- **LS.DEL.INFRA-R04 Adoption over recreation:** Bringing a live resource under
  declared state never recreates, replaces, or interrupts it. Adopted
  2026-07-27 (interview).
- **LS.DEL.INFRA-R05 Organization-owned accounts:** Provider accounts are owned
  by the `livestorejs` organization, not by an individual's personal account.
  Adopted 2026-07-27 (interview).
- **LS.DEL.INFRA-R06 Credentials use the provider's secret mechanism:** A
  credential held in a provider surface is stored using that provider's secret
  facility, never as ordinary configuration. Providers expose plain
  configuration in build logs, previews, and read APIs, and a credential stored
  that way is also unsafe to adopt into declared state.
  `refines: LS.DEL.INFRA-R03` Adopted 2026-07-27 (interview).

## Open Design Questions

- **LS.DEL.INFRA-DQ2 Unattributed live dependency.** Ten of the eleven
  hand-authored `livestore.dev` DNS records serve a Clerk instance — auth,
  DKIM, and mail hostnames for both the production and development subdomains —
  and a `PUBLIC_CLERK_PUBLISHABLE_KEY` repository secret exists alongside them.
  The instance is live: `clerk.livestore.dev` answers with a real configuration.
  Nothing in this repository references Clerk, and no workflow reads that
  secret, so what depends on it is unknown. The records are declared because
  removing a live dependency you cannot identify is worse than keeping one you
  cannot explain, but "keep it, it seems load-bearing" is not a decision.
  Resolving this means finding the consumer or retiring the instance.

- **LS.DEL.INFRA-DQ1 Secret projection drift.** `LS.DEL.INFRA-R03` makes
  1Password canonical, but nothing detects when a projection drifts from it. The
  Mixedbread API key exists in at least three places — 1Password, the
  `MXBAI_API_KEY` GitHub Actions secret, and the Netlify environment variable —
  and the Netlify copy is deliberately never read back (secret values are
  write-only in the Netlify API). How projection drift is detected, or why
  detecting it is unnecessary, is undecided.
