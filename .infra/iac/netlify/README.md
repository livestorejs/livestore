# Netlify IaC — docs runtime env vars

OpenTofu-managed desired state for the **runtime environment variables** of the
two existing docs Netlify sites — `livestore-docs` (https://docs.livestore.dev)
and `livestore-docs-dev` (https://dev.docs.livestore.dev). These give the SSR
search function (`/api/search`) its Mixedbread credentials at runtime.

This is the first managed resource of LiveStore's Infrastructure-as-Code surface
and seeds [#1244](https://github.com/livestorejs/livestore/issues/1244)
("Move LiveStore public domains to Cloudflare-managed IaC"): it establishes the
OpenTofu state + encryption + provider conventions that the broader public-web
IaC (Netlify docs domain, `livestore.dev` DNS, `*.workers.dev` example domains)
will extend.

## Scope — env vars only (prod-safety)

This config manages four `netlify_environment_variable` resources — one pair
per docs surface, keyed by `prod` / `dev`:

| Key                     | Secret? | Scopes                     | Contexts                                       |
| ----------------------- | ------- | -------------------------- | ---------------------------------------------- |
| `MXBAI_API_KEY`         | yes     | builds, functions, runtime | production, deploy-preview, branch-deploy, dev |
| `MXBAI_VECTOR_STORE_ID` | no      | builds, functions, runtime | all                                            |

**It cannot disrupt the live site.** There is no `netlify_site` resource and no
site data source — the site is referenced by its literal `site_id`/`team_id`, so
OpenTofu can never create, replace, or mutate the site, its build settings, or
its deploys. The only resource type is `netlify_environment_variable`.

Identifiers (verified via the Netlify API):

| What    | Value                                  |
| ------- | -------------------------------------- |
| site    | `livestore-docs` (docs.livestore.dev)  |
| site_id | `abeae053-d336-480a-a0fe-f0aaaacaa74e` |
| team_id | `66db1fd95431120089f47e20` (livestore) |

## Secrets & values (`op://` refs)

Only the Mixedbread **API key** is a real secret; it is injected at runtime and
never hardcoded. The vector store id is an opaque, non-secret identifier
hardcoded as a default (the API key is the actual gate).

| TF variable                   | Source                                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------------------- |
| `netlify_api_token`           | Existing Netlify CLI login at `~/.config/netlify/config.json` (or `NETLIFY_AUTH_TOKEN`)             |
| `mxbai_api_key`               | 1Password: `op://ialr3ed3depgv523r3bqojsyjq/6lpbvcuq6mdasuheabe3ms7rdm/djua6eaktvatttoxnu6e6qsqai`  |
| `state_encryption_passphrase` | 1Password: `op://LiveStore/livestore-tofu-state-encryption/password`                                |
| `mxbai_vector_store_id`       | Hardcoded non-secret default: the **production** store `fff51624-…` (no override needed)              |

The devenv tasks read these via `op-proxy` (or pre-set `TF_VAR_*` / env in CI).

## State backend — encrypted, committed

`livestorejs/livestore` is a **public** repo, so the rule is that **state must
contain no secret**. It does not: the API key resource is adopt-only and owns
shape rather than value, so the only value in state is the non-secret vector
store id (verified by decrypting the committed state). State is committed, and
additionally encrypted as defence in depth against a future mistake:

- **OpenTofu native state encryption** (`terraform { encryption {} }`,
  PBKDF2/AES-GCM, `enforced = true`). The passphrase lives in 1Password
  (`op://LiveStore/livestore-tofu-state-encryption/password`) and is injected at
  runtime — never committed. The committed `state/netlify.tfstate` is ciphertext;
  a missing passphrase is a hard error (no silent plaintext writes).
- The `state/` directory is committed; transient `*.tfstate.backup`,
  `.terraform/`, and any `*.tfvars` are git-ignored.

**When does state have to move?** Not on a schedule — on a trigger. The moment a
resource is declared whose state would carry secret material, state must leave
the repository *first*, because a commit cannot be retracted. Until then a
committed, secret-free state is fine and gives shared ownership for free.

The intended destination is a Cloudflare R2 (`backend "s3"`) bucket. R2 is not
enabled on the LiveStore Cloudflare account — the API returns code `10042`, and
enablement is an account-level dashboard action that no API token can perform.
Since the same account work is required by
[#1244](https://github.com/livestorejs/livestore/issues/1244), do it before that
work rather than during it. To migrate: enable R2, create an R2 S3 access key,
swap `backend "local"` for `backend "s3"` in `versions.tf` (keep the
`encryption` block), and run `tofu init -migrate-state`.

## Adopting the live resources (import, not recreate)

Both env vars were already live on the site. They were **imported** into state
(import id format `<team_id>:<site_id>:<KEY>`), so OpenTofu now *owns* them
without recreating anything:

```bash
tofu import netlify_environment_variable.mxbai_api_key \
  66db1fd95431120089f47e20:abeae053-d336-480a-a0fe-f0aaaacaa74e:MXBAI_API_KEY
tofu import netlify_environment_variable.mxbai_vector_store_id \
  66db1fd95431120089f47e20:abeae053-d336-480a-a0fe-f0aaaacaa74e:MXBAI_VECTOR_STORE_ID
```

After import, `tofu plan` reports **`No changes`** — proving the IaC owns the
live resources without modifying them.

> Note on the secret value: the Netlify API masks secret env-var values on read,
> so an imported secret resource carries no usable value and the value cannot be
> round-tripped. Without handling, every plan would show a cosmetic in-place
> "update" of `secret_values`, so `MXBAI_API_KEY` declares
> `lifecycle { ignore_changes = [secret_values] }`.
>
> This config therefore owns the variable's **shape**, never its value.
> 1Password is the canonical source (`LS.DEL.INFRA-R03`) and **rotation happens
> there**, not through OpenTofu — applying a rotation here would write the key
> into state, and this repository is public and permanent.

## Commands

Run from the repo root via devenv tasks (secrets auto-injected via op-proxy):

```bash
dt infra:netlify:plan          # read-only; shows the diff, exits 0
dt infra:netlify:drift-check   # same plan, but drift exits non-zero (used by CI)
dt infra:netlify:apply         # only after plan shows the intended diff
```

Drift is checked automatically by `.github/workflows/infra-drift.yml` on a
weekday schedule and on any push touching `.infra/iac/**`. A declaration nobody
checks is documentation rather than a control, so any change made to these
variables outside this config turns that job red.

No apply is needed for steady state — the values are already live and `plan`
shows `No changes`. Apply is idempotent (re-sets the secret to the same value).

## Architecture

```
.infra/iac/netlify/  (OpenTofu / HCL)
  → Netlify API (env vars only, scoped to existing site_id)

state/netlify.tfstate  → encrypted at rest (committed ciphertext)
```

- `versions.tf` — provider pin (`netlify/netlify`), local backend, state encryption.
- `provider.tf` — Netlify provider (token via `var.netlify_api_token`).
- `variables.tf` — typed inputs (secrets marked `sensitive`).
- `env.tf` — the two `netlify_environment_variable` resources.

To bump the provider, see the note in `versions.tf` and check
<https://github.com/netlify/terraform-provider-netlify/releases>.
