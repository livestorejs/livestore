# Runtime environment variables for the two existing docs Netlify sites. These
# give the SSR search function (`/api/search`) its Mixedbread credentials at
# runtime.
#
# PROD-SAFETY: there is no `netlify_site` resource and no site data source —
# each site is referenced by its known literal ID, so OpenTofu can never create,
# replace, or mutate a site, its build settings, or its deploys. The blast
# radius of `infra:netlify:apply` is environment variables (this file) plus DNS
# records and site domain settings (`dns.tf`) — see that file for the DNS and
# domain scope. A plan must show `No changes` against the live environment (see
# README.md).
#
# Identifiers (verified via the Netlify API):
#   team_id : 66db1fd95431120089f47e20 (livestore account)
#   prod    : livestore-docs      (docs.livestore.dev)     abeae053-…
#   dev     : livestore-docs-dev  (dev.docs.livestore.dev) e02ba783-…

locals {
  livestore_team_id = "66db1fd95431120089f47e20"

  # Each docs surface searches only the content it serves
  # (LS.DOCS.SEARCH-R03), so the store id differs per surface while the
  # credential is the same 1Password-canonical value for both.
  docs_surfaces = {
    prod = {
      site_id  = "abeae053-d336-480a-a0fe-f0aaaacaa74e"
      store_id = var.mxbai_vector_store_id_prod
    }
    dev = {
      site_id  = "e02ba783-ea85-4be1-8b7f-c1b2b4d0d307"
      store_id = var.mxbai_vector_store_id_dev
    }
  }
}

# --- Secret: Mixedbread API key ---
resource "netlify_environment_variable" "mxbai_api_key" {
  for_each = local.docs_surfaces

  team_id = local.livestore_team_id
  site_id = each.value.site_id
  key     = "MXBAI_API_KEY"

  # Required explicit scopes for secret env vars (provider requirement on free
  # plans). `runtime` is what the SSR function reads; `builds` is read by the
  # Starlight plugin in `docs/astro.config.ts` at build time.
  scopes = ["builds", "functions", "runtime"]

  # Netlify rejects the `all` context for *secret* env vars (422: "Secrets are
  # not allowed to have 'All contexts' context"). Enumerate every context that
  # `all` would expand to.
  secret_values = [
    { context = "production", value = var.mxbai_api_key },
    { context = "deploy-preview", value = var.mxbai_api_key },
    { context = "branch-deploy", value = var.mxbai_api_key },
    { context = "dev", value = var.mxbai_api_key },
  ]

  lifecycle {
    # The Netlify API masks secret env-var values on read, so an imported secret
    # resource carries no usable value in state and the value cannot be
    # round-tripped. Without this, every `plan` would forever show an in-place
    # "update" for `secret_values` even though the live value already matches
    # 1Password — a cosmetic diff, not real drift.
    #
    # This declaration therefore owns the variable's *shape* — that it exists,
    # with these scopes and contexts — and never its value. 1Password is the
    # canonical source for the value (LS.DEL.INFRA-R03), and rotation happens
    # there rather than through this config. Consequently the committed state
    # holds no secret, which is what makes committing it acceptable at all.
    #
    # Do not "fix" this by dropping the ignore and applying: that writes the key
    # into state, and this repository is public and permanent.
    ignore_changes = [secret_values]
  }
}

# --- Non-secret: Mixedbread vector store id ---
resource "netlify_environment_variable" "mxbai_vector_store_id" {
  for_each = local.docs_surfaces

  team_id = local.livestore_team_id
  site_id = each.value.site_id
  key     = "MXBAI_VECTOR_STORE_ID"
  scopes  = ["builds", "functions", "runtime"]

  # Non-secret: a plain (non-sensitive) value, not a secret_values block.
  values = [
    { context = "all", value = each.value.store_id },
  ]
}
