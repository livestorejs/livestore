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
2. **Store the private key** as the `LIVESTORE_RULESET_APP_KEY` environment
   secret in `livestore`'s `github-admin` environment, with deployment branches
   limited to `main`. Remove any org-level grant to these repositories and any
   repo-level secret of the same name; neither may provide an alternate path to
   the key. When enrolling `livestore-contrib`, use the same environment-secret
   containment in that repository before enabling its reconcile workflow.
3. **Record the App ID / Client ID** as non-secret constants in the reconcile
   workflow's Genie source.
4. **Install the App** on both repos with the ruleset (Administration)
   permission.
5. **On any later permission or event change:** review the live App settings
   against the committed manifest. Edit permissions in the settings UI (no API),
   which forces installations to re-consent, and update the manifest to match.

App-definition review is manual. The repository CLI does not receive the App
private key or mint JWTs to inspect the App definition. The dedicated
`actions/create-github-app-token` step receives the key and passes only its scoped
installation token to the ruleset commands.
