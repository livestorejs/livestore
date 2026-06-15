# Runtime environment variables for the existing `livestore-docs` Netlify site
# (https://docs.livestore.dev). These give the SSR search function
# (`/api/search`) its Mixedbread credentials at runtime.
#
# PROD-SAFETY: this config manages ONLY environment variables. There is no
# `netlify_site` resource and no site data source — the site is referenced by
# its known literal ID, so OpenTofu can never create, replace, or mutate the
# site, its build settings, or its deploys. The only resource type is
# `netlify_environment_variable`. A plan must show `No changes` once the two
# already-live env vars are imported (see README.md).
#
# Identifiers (verified via the Netlify API):
#   site    : livestore-docs (docs.livestore.dev)
#   site_id : abeae053-d336-480a-a0fe-f0aaaacaa74e
#   team_id : 66db1fd95431120089f47e20 (livestore account)

locals {
  livestore_docs_site_id = "abeae053-d336-480a-a0fe-f0aaaacaa74e"
  livestore_team_id      = "66db1fd95431120089f47e20"
}

# --- Secret: Mixedbread API key ---
resource "netlify_environment_variable" "mxbai_api_key" {
  team_id = local.livestore_team_id
  site_id = local.livestore_docs_site_id
  key     = "MXBAI_API_KEY"

  # Required explicit scopes for secret env vars (provider requirement on free
  # plans). `runtime` is what the SSR function reads.
  scopes = ["builds", "functions", "runtime"]

  # Netlify rejects the `all` context for *secret* env vars (422: "Secrets are
  # not allowed to have 'All contexts' context"). Enumerate every context that
  # `all` would expand to, so production + previews + branches + dev all get the
  # key and search works everywhere.
  secret_values = [
    { context = "production", value = var.mxbai_api_key },
    { context = "deploy-preview", value = var.mxbai_api_key },
    { context = "branch-deploy", value = var.mxbai_api_key },
    { context = "dev", value = var.mxbai_api_key },
  ]

  lifecycle {
    # The Netlify API treats secret env-var values as WRITE-ONLY: it never
    # returns them on read/import, so an imported secret resource has an empty
    # `secret_values` in state. Without this, every `plan` would forever show an
    # in-place "update" for `secret_values` even though the live value already
    # matches 1Password — a cosmetic, unavoidable diff, not real drift. Ignoring
    # it makes `plan` report `No changes` (the import truly adopted the live
    # resource). The value is still written once on the initial `apply`; to
    # rotate the key, change it in 1Password and run a targeted
    # `tofu apply -replace` (or temporarily drop this ignore).
    ignore_changes = [secret_values]
  }
}

# --- Non-secret: Mixedbread vector store id ---
resource "netlify_environment_variable" "mxbai_vector_store_id" {
  team_id = local.livestore_team_id
  site_id = local.livestore_docs_site_id
  key     = "MXBAI_VECTOR_STORE_ID"
  scopes  = ["builds", "functions", "runtime"]

  # Non-secret: a plain (non-sensitive) value, not a secret_values block.
  values = [
    { context = "all", value = var.mxbai_vector_store_id },
  ]
}
