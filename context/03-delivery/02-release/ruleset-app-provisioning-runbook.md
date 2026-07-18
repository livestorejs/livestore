# Runbook — reconcile GitHub App provisioning

The irreducible manual lifecycle for the ruleset-reconcile GitHub App (see
[spec.md](./spec.md) §Ruleset Reconciliation and
[.decisions/0001](./.decisions/0001-ruleset-reconciliation.md)). GitHub imposes a
manual core for App lifecycle; these steps are the **complete** non-IaC surface —
everything else is declarative (the committed manifest) or automated (the
reconcile workflow). Platform limits that force each step:
[.reference/github-app-platform-constraints.md](./.reference/github-app-platform-constraints.md).

Each step is performed once by an org owner and recorded.

1. **Register the App** from the committed manifest (browser handshake: `POST`
   manifest → redirect → exchange the temporary `code`). Generates the App ID +
   private key.
2. **Store the private key** as the org Actions secret
   `LIVESTORE_RULESET_APP_KEY`, restricted to `livestore` + `livestore-contrib`.
3. **Record the App ID / Client ID** as non-secret constants in the reconcile
   workflow's Genie source.
4. **Install the App** on both repos with the ruleset (Administration)
   permission.
5. **On any later permission change:** edit `default_permissions` in the App
   settings UI (no API), which forces installations to re-consent; then update
   the committed manifest to match so the App drift-check passes.

The App-definition drift-check (spec §Ruleset Reconciliation) exists so that
divergence between steps 1/5 and the committed manifest is *detected* rather than
silent.
