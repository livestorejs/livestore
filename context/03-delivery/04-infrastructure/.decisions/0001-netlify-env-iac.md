# Netlify environment-variable IaC — key decisions

Status: accepted (2026-07-27 interview).

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

The Netlify API treats secret environment-variable values as write-only: they
are accepted on write and never returned on read or import. As of provider
`netlify/netlify` v0.4.4 the nested `secret_values.value` attribute is typed
`(String, Sensitive)` rather than write-only, so there is no provider-supported
way to send a value without persisting it to state.

| Option | Rejected because |
| --- | --- |
| Own the value — `apply` writes the key | Puts a live credential into state, and therefore into public git history under [DELTA-001](../.delta/DELTA-001-state-ciphertext-committed.md), permanently |
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

## State Is Committed As Ciphertext, Under Protest

State is committed to a public repository, encrypted with OpenTofu native state
encryption (PBKDF2-SHA512, 600k iterations, AES-GCM, `enforced = true`).

| Option | Rejected because |
| --- | --- |
| Cloudflare R2 `backend "s3"` | R2 is not enabled on the LiveStore Cloudflare account — the API returns code `10042`, a dashboard-only action that cannot be scripted with the CI token |
| Plaintext state, git-ignored | State is then unshared; the next operator's `plan` cannot see prior ownership |
| No state at all — re-import per run | Makes `plan` non-trivial to run and defeats drift detection as a routine check |

This is the intended backend only until R2 is enabled. Committing ciphertext
converts an immediate disclosure into an offline attack against the passphrase,
which `LS.DEL.INFRA-R02` does not accept; the deviation is tracked as
[DELTA-001](../.delta/DELTA-001-state-ciphertext-committed.md). The `encryption`
block survives the migration unchanged — only the backend swaps.
