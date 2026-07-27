# DELTA-002 — Most infrastructure is not declared state

Status: open

## Divergence

`LS.DEL.INFRA-R01` requires every third-party resource LiveStore depends on to
be described as declared state in-repo. Reality: exactly two Netlify
environment variables are declared. Everything else is configured imperatively
in workflow YAML or by hand in a provider dashboard, with no reviewable
description of intended state and no drift detection.

| Surface | Provider | How it is configured today |
| --- | --- | --- |
| Docs site (build, deploys, CDN purge) | Netlify | `.github/workflows/deploy-prod.yml` |
| Docs search index | Mixedbread | `.github/workflows/sync-docs.yml` |
| Examples hosting | Cloudflare Workers | `.github/workflows/deploy-prod.yml` |
| `livestore.dev` DNS and domains | Cloudflare | dashboard only |
| CI runners | Namespace, GitHub-hosted | `runs-on` labels in workflow YAML |
| Community bot | Discord | not in this repository |

The practical cost is that a dashboard change is invisible to review, and no
`plan` anywhere reports that live state has drifted from intent.

Note that imperative deploy *mechanics* are owned by
[02-release](../../02-release/requirements.md) and are not in scope here — this
delta is about the absence of declared *resource* state, not about how deploys
run.

## VRS

[requirements.md](../requirements.md) `LS.DEL.INFRA-R01`; the surface table in
[spec.md](../spec.md).

## Implementation Contract

Extend `.infra/iac/` provider-by-provider, adopting each existing resource by
import so no adoption disrupts a live surface (`LS.DEL.INFRA-R04`). The
Cloudflare surface — `livestore.dev` DNS and the `*.workers.dev` example
domains — is tracked as livestorejs/livestore#1244 and is the intended next
step.

That work carries an ordering hazard worth naming here. Declaring a resource
whose state would carry secret material is the trigger for moving state out of
the repository (see [../spec.md](../spec.md), "State carries no secret"), and
the intended destination is a Cloudflare R2 bucket on the same account being
declared. R2 enablement is a human dashboard action
([../.reference/cloudflare-r2-enablement.md](../.reference/cloudflare-r2-enablement.md)),
so it must happen before that work begins rather than during it. DNS records
alone carry no secret and do not trip the trigger.

The Discord bot is out-of-repo infrastructure: this repository contains only
`DISCORD_INVITE_URL` (`packages/@local/shared/src/CONSTANTS.ts`). Declaring it
requires first deciding where it is owned; until then it is named here so its
absence is deliberate rather than overlooked.

Close this delta when every row above is either declared or has an explicit
recorded decision not to declare it.
