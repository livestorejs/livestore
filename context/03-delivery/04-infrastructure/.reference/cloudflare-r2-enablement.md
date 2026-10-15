# Cloudflare R2 enablement is an account-level, human-only action

External platform constraint, recorded because the remote-state design in
[spec.md](../spec.md) depends on it, and because
[requirements.md](../requirements.md) `LS.DEL.INFRA-R01` will need it as
declared infrastructure grows.

## The constraint

R2 must be onboarded at the Cloudflare account level — accepting R2 terms and
attaching billing — before any R2 API call succeeds. Until then the API returns
error code `10042` ("Please enable R2 through the Cloudflare Dashboard").

Enablement is a subscription action with no public API, so it cannot be
performed by an API token regardless of how that token is scoped. It is a
one-time human action in the Cloudflare dashboard. Observed on the LiveStore
account 2026-06-15 (during the work that became livestorejs/livestore#1330) and
not since re-verified.

R2's free tier covers an OpenTofu state file with very large margin; the
practical cost of enablement is attaching a payment method, not usage.

## Why it matters here

R2 is the intended home for OpenTofu state once state must leave the
repository. It is also part of the surface that
livestorejs/livestore#1244 will manage, so the same account work unblocks both
— the state backend and the managed resources are on the same account.

Note the ordering hazard this creates: the trigger for needing remote state
(declaring a resource whose state carries secret material) can arrive in the
same change that would declare Cloudflare resources. Enablement should
therefore happen before that work starts, not during it.
