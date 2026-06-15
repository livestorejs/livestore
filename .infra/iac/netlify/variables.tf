# Netlify personal access token for the provider. Injected at runtime via
# TF_VAR_netlify_api_token (the devenv task reads it from the existing Netlify
# CLI login at ~/.config/netlify/config.json, mirroring scripts/src/shared/netlify.ts).
variable "netlify_api_token" {
  type      = string
  sensitive = true
}

# Passphrase for OpenTofu native state encryption (PBKDF2 key provider).
# Injected at runtime via TF_VAR_state_encryption_passphrase, sourced from
# 1Password: op://LiveStore/livestore-tofu-state-encryption/password.
variable "state_encryption_passphrase" {
  type      = string
  sensitive = true
}

# Mixedbread API key (the only real secret). Injected via TF_VAR_mxbai_api_key,
# sourced from 1Password. Stored on Netlify as a "secret" env var.
variable "mxbai_api_key" {
  type      = string
  sensitive = true
}

# Mixedbread vector store id — an opaque, non-secret identifier (the API key is
# the actual gate). Hardcoded as a non-sensitive default; no override needed.
variable "mxbai_vector_store_id" {
  type    = string
  default = "3c3548fb-f2e2-4a71-8080-bfbb0db03994"
}
