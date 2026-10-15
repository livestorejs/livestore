# Netlify environment-variable behaviour

External platform behaviour, recorded because `LS.DEL.INFRA-R02` and
`LS.DEL.INFRA-R06` reason about what a provider does with a stored credential.
Observed 2026-07-27 against the `livestore` account.

## Secret values are masked on read, except the `dev` context

A variable stored with `is_secret: true` returns masked values (`****abcd`) for
the `production`, `deploy-preview`, and `branch-deploy` contexts, but returns
the **`dev` context value in plaintext**. This was reproduced on both docs
sites, so it is platform behaviour rather than a per-variable misconfiguration.

Two consequences:

- The `dev` context is not a safe place to hold a credential, because marking
  the variable secret does not conceal it there. Where a local `netlify dev`
  workflow does not actually need the value, omitting the `dev` context is
  strictly better than setting it.
- "Write-only" describes the intent of the API, not a guarantee it enforces.
  What the masking reliably provides is that a secret value cannot be
  *round-tripped* — which is why an adopted secret resource owns shape rather
  than value — not that the value is unreadable.

## Non-secret values are returned verbatim

A variable stored with `is_secret: false` returns its value in full to any
token with read access, and is exposed to build logs. A credential stored this
way is therefore disclosed to every principal with site access, and is also
unsafe to adopt into declared state, since import writes non-secret values into
state verbatim. This is the concrete reason behind `LS.DEL.INFRA-R06`.

## Environment changes require a rebuild, not a re-publish

Netlify injects environment variables into the function bundle at build time.
Changing a variable does not affect the running site, and restoring an existing
deploy re-publishes the same artifact with the old values. A corrected
credential takes effect only on that site's next real build.
