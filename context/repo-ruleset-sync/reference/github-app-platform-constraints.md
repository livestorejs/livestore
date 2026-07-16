# GitHub App — platform constraints (validated 2026-07)

External GitHub-platform facts that constrain how far a GitHub App can be
managed as code. These bound the non-IaC surface that must be documented rather
than automated. Validated against GitHub docs and the Terraform GitHub provider.

## App definition

- **Creation is a browser handshake, not a server-side create.** An App is
  registered from an [App Manifest](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest):
  `POST` the manifest JSON to `…/organizations/<org>/settings/apps/new`, GitHub
  redirects back with a temporary `code`, then
  `POST /app-manifests/{code}/conversions` returns the App ID, private key
  (PEM), client secret, and webhook secret. There is no unattended
  "create app with these permissions" REST endpoint — creation needs a one-time
  interactive step (or a pre-obtained conversion `code`, which is short-lived).
- **The manifest is declarative.** It specifies `name`, `default_permissions`
  (key = permission name, value = access level), `default_events`, webhook
  config, and `public`. This is the source-of-truth definition artifact.
- **No API to update an existing App's `default_permissions`.** Permission
  changes are UI-only and force every installation to re-consent. An `update`
  path can therefore only *detect* drift and surface a required manual action —
  it cannot converge.
- **Read is available.** `GET /app` (authenticated with the App JWT) returns the
  live definition, sufficient for drift detection.

## Installation & tokens

- **Installation is semi-manual.** Installing the App on the repo/org is a UI
  action (or API-driven with the App's own credentials). Binding an existing
  installation to specific repos *is* REST-manageable.
- **The private key is irreducible.** Minting short-lived installation tokens
  requires the App's private key (JWT → installation token, e.g. via
  `actions/create-github-app-token`). There is no OIDC-only path that avoids
  storing the private key. It is the single unavoidable long-lived secret.
- **App ID / Client ID are not secret.** They are generated identifiers that can
  be committed as non-secret configuration.

## Tooling coverage

- **Terraform's GitHub provider does not define/create Apps.** It only
  *consumes* an existing App for authentication and manages installation-level
  resources ([registry docs](https://registry.terraform.io/providers/integrations/github/latest/docs)).
- **Alchemy has no `App` resource yet.** Its `GitHub` provider covers
  `Repository`, `Secret`, `Variable`, `Webhook`, `RepositoryEventSource`, etc.
  Tracked upstream: [alchemy-run/alchemy#843](https://github.com/alchemy-run/alchemy/issues/843).

## Consequence for this subsystem

The App's *definition* can be a committed, drift-checked artifact (the manifest),
but its *lifecycle* (creation, permission edits, installation, key generation)
has an irreducible manual core. The IaC boundary is therefore "manifest as spec +
drift verify", with the manual steps enumerated as an explicit provisioning
runbook — see [`../spec.md`](../spec.md) and
[`../decisions/0001-github-app-definition-as-iac.md`](../decisions/0001-github-app-definition-as-iac.md).
