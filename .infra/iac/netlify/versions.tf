terraform {
  required_version = ">= 1.7"

  # To update the provider: check
  # https://github.com/netlify/terraform-provider-netlify/releases
  # then bump the version below and re-run `dt infra:netlify:plan`.
  required_providers {
    netlify = {
      source  = "netlify/netlify"
      version = "0.4.3"
    }
  }

  # Local backend. The state file lives next to this config and is committed to
  # the repo, but ONLY in encrypted form (see the `encryption` block below).
  # livestorejs/livestore is a PUBLIC repo, so plaintext state must never be
  # committed: OpenTofu state holds the Mixedbread API key value even though the
  # input variable is marked `sensitive`.
  #
  # Why local-encrypted instead of a remote S3/R2 backend: R2 is not enabled on
  # the LiveStore Cloudflare account (the API returns code 10042 "Please enable
  # R2 through the Cloudflare Dashboard"), which is a dashboard-only action that
  # cannot be scripted with the available CI token. OpenTofu native state
  # encryption with the ciphertext committed is the sanctioned fallback: it
  # gives the same at-rest secrecy guarantee without a remote bucket. Migrate to
  # an R2 `backend "s3"` once R2 is enabled (drop this `backend "local"`, keep
  # the `encryption` block, then `tofu init -migrate-state`).
  backend "local" {
    path = "state/netlify.tfstate"
  }

  # OpenTofu native state encryption. The plan/state cannot be read or written
  # without the passphrase, which is injected at runtime via the
  # TF_ENCRYPTION_PASSPHRASE env var (sourced from 1Password) — never committed.
  # `enforced = true` makes an unencrypted read/write a hard error, so a missing
  # passphrase fails loudly instead of silently writing plaintext state.
  encryption {
    key_provider "pbkdf2" "passphrase" {
      passphrase = var.state_encryption_passphrase
    }

    method "aes_gcm" "default" {
      keys = key_provider.pbkdf2.passphrase
    }

    state {
      method   = method.aes_gcm.default
      enforced = true
    }

    plan {
      method   = method.aes_gcm.default
      enforced = true
    }
  }
}
