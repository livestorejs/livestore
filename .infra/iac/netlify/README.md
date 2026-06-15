# Netlify IaC — livestore-docs runtime env vars

OpenTofu-managed desired state for the **runtime environment variables** of the
existing `livestore-docs` Netlify site (https://docs.livestore.dev). These give
the SSR search function (`/api/search`) its Mixedbread credentials at runtime.

This is the first managed resource of LiveStore's Infrastructure-as-Code surface
and seeds [#1244](https://github.com/livestorejs/livestore/issues/1244)
("Move LiveStore public domains to Cloudflare-managed IaC"): it establishes the
OpenTofu state + encryption + provider conventions that the broader public-web
IaC (Netlify docs domain, `livestore.dev` DNS, `*.workers.dev` example domains)
will extend.

## Scope — env vars only (prod-safety)

This config manages exactly two `netlify_environment_variable` resources:

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
| `mxbai_vector_store_id`       | Hardcoded non-secret default `3c3548fb-f2e2-4a71-8080-bfbb0db03994` (no override needed)             |

The devenv tasks read these via `op-proxy` (or pre-set `TF_VAR_*` / env in CI).

## State backend — encrypted, committed

`livestorejs/livestore` is a **public** repo and OpenTofu state holds the
Mixedbread API key value (even though the input variable is `sensitive`). State
is therefore committed **only in encrypted form**:

- **OpenTofu native state encryption** (`terraform { encryption {} }`,
  PBKDF2/AES-GCM, `enforced = true`). The passphrase lives in 1Password
  (`op://LiveStore/livestore-tofu-state-encryption/password`) and is injected at
  runtime — never committed. The committed `state/netlify.tfstate` is ciphertext;
  a missing passphrase is a hard error (no silent plaintext writes).
- The `state/` directory is committed; transient `*.tfstate.backup`,
  `.terraform/`, and any `*.tfvars` are git-ignored.

**Why not remote R2?** The intended backend was a Cloudflare R2 (`backend "s3"`)
bucket, but **R2 is not enabled on the LiveStore Cloudflare account** — the API
returns code `10042` ("Please enable R2 through the Cloudflare Dashboard"), a
dashboard-only action that can't be scripted with the CI token. Native
encryption with committed ciphertext is the sanctioned fallback and gives the
same at-rest secrecy guarantee. To migrate later: enable R2 + create an R2 S3
access key, swap `backend "local"` for `backend "s3"` in `versions.tf` (keep the
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

> Note on the secret value: the Netlify API treats secret env-var values as
> **write-only** (it never returns them on read/import). Without handling, every
> plan would forever show a cosmetic in-place "update" of `secret_values`. The
> `MXBAI_API_KEY` resource therefore declares
> `lifecycle { ignore_changes = [secret_values] }` so plan reports `No changes`.
> The value is still written on the initial `apply`; to rotate the key, change it
> in 1Password and run `tofu apply -replace=netlify_environment_variable.mxbai_api_key`
> (or temporarily drop the ignore).

## Commands

Run from the repo root via devenv tasks (secrets auto-injected via op-proxy):

```bash
dt infra:netlify:plan    # read-only; must show "No changes"
dt infra:netlify:apply   # only after plan shows No changes / the intended diff
```

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
