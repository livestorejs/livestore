# Netlify environment-variable IaC — key decisions

Status: accepted (2026-07-27 interview).

Evidence: the committed state was decrypted and inspected on 2026-07-27. Both
imported resources carry `secret_values: absent`; the only value present is the
non-secret vector store id, which is also a literal in `variables.tf`. No
credential material appears in the state. This is what makes the committed-state
backend acceptable, and it is the property later changes must preserve.

Records the durable decisions behind the first declared-state surface: the
`livestore-docs` Netlify environment variables that back the docs search
function (`docs/src/pages/api/search.ts`).

## Scope Is Environment Variables Only

The configuration declares two `netlify_environment_variable` resources and
refers to the site by literal `site_id`/`team_id`.

| Option | Rejected because |
| --- | --- |
| Declare the `netlify_site` resource | Puts the live docs site one bad plan away from replacement, for no gain |
| Read the site through a data source | Couples every plan to site read permissions without making the site declarative |

With no site resource and no site data source, OpenTofu cannot create, replace,
or mutate the site, its build settings, or its deploys. Prod-safety is
structural, not procedural.

## Adopt-Only Ownership Of The Secret Value

The declaration owns the *shape* of `MXBAI_API_KEY` — that it exists, with which
scopes and contexts — and never its value. Both variables were already live and
were imported; `plan` reports no changes.

The Netlify API masks secret environment-variable values on read, so an
imported secret resource has no usable value in state. Masking is a read-time
behaviour of the API rather than a guarantee the value can never be observed,
so it is not relied on for secrecy — only for the fact that a secret value
cannot be round-tripped, which is what forces the ownership question. As of
provider
`netlify/netlify` v0.4.4 the nested `secret_values.value` attribute is typed
`(String, Sensitive)` rather than write-only, so there is no provider-supported
way to send a value without persisting it to state.

| Option | Rejected because |
| --- | --- |
| Own the value — `apply` writes the key | Puts a live credential into state, and therefore into permanent public git history |
| Ephemeral / write-only attribute | Not offered by the provider at v0.4.4 |

`lifecycle { ignore_changes = [secret_values] }` keeps the imported resource
free of the value indefinitely. The value is governed by `LS.DEL.INFRA-R03`
(1Password is canonical) rather than by this declaration.

## The Real Key Is Injected At Plan Time

`var.mxbai_api_key` is resolved from 1Password on every `plan`, even though
adopt-only ownership means it is never sent.

| Option | Rejected because |
| --- | --- |
| Placeholder default, no secret fetch | `ignore_changes` does not protect `-replace`; a documented rotation would overwrite the live production key with the placeholder and break docs search |
| Drop the secret resource entirely | Loses drift detection on the variable's scopes and contexts — the one thing declaring it still buys |

The cost is a credential fetch on a read-only operation. It is accepted so that
the one path that does consume the variable — a deliberate `-replace` to rotate
— sends the correct value rather than a destructive placeholder.

## State Is Committed, And Carries No Secret

State is committed to the repository, encrypted with OpenTofu native state
encryption (PBKDF2-SHA512, 600k iterations, AES-GCM, `enforced = true`) using a
generated 64-character passphrase held in 1Password.

| Option | Rejected because |
| --- | --- |
| Cloudflare R2 `backend "s3"` | R2 is not enabled on the account, and enabling it is a human dashboard action — see [.reference/cloudflare-r2-enablement.md](../.reference/cloudflare-r2-enablement.md). Not justified by a two-variable surface whose state holds no secret |
| Plaintext state, git-ignored | State is then unshared; the next operator's `plan` cannot see prior ownership |
| No state at all — re-import per run | Makes `plan` non-trivial to run and defeats drift detection as a routine check |

Committing state is acceptable *because* the state carries no secret, not
because encryption makes committing a secret safe — it would not, since history
is permanent and a passphrase rotation cannot retract published ciphertext. The
encryption is defence in depth against a mistake.

This backend therefore holds until a resource whose state carries secret
material is declared, which is the trigger for moving state out of the
repository (see [spec.md](../spec.md), "State carries no secret"). The
`encryption` block survives that migration unchanged — only the backend swaps.
