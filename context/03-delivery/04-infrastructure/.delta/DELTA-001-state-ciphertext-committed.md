# DELTA-001 — OpenTofu state is committed to the public repo as ciphertext

Status: open

## Divergence

`LS.DEL.INFRA-R02` requires that no committed artifact contain a secret
recoverable by a reader, explicitly including ciphertext whose secrecy rests
only on a passphrase. Reality: `.infra/iac/netlify/state/netlify.tfstate` is
committed to a public repository, encrypted with OpenTofu native state
encryption (PBKDF2-SHA512, 600k iterations, AES-GCM, `enforced = true`), with
the passphrase held in 1Password.

The violation is latent rather than active. Both environment variables were
adopted by import and no `apply` has run, and the Netlify API never returns
secret values on read — so the committed ciphertext currently decrypts to
resource metadata with an empty `secret_values`, and holds no credential.

What diverges is the mechanism, not today's file. Committing state as the
standing backend means the first operation that puts a value into state — a
rotation via `tofu apply -replace`, per
[.decisions/0001-netlify-env-iac.md](../.decisions/0001-netlify-env-iac.md) —
publishes that credential as ciphertext into permanent public git history.
Because `LS.DEL.INFRA-A01` makes commits irretractable, the exposure would not
be fixable after the fact: rotating the passphrase does not help, since the old
ciphertext remains readable in history, and the only true remediation would be
rotating the Mixedbread key itself.

Three properties are therefore load-bearing while this delta is open:

- The state-encryption passphrase must be high-entropy and generated, not
  memorable. Its strength is the entire security margin against an offline
  attacker holding the ciphertext indefinitely.
- A rotation's resulting state must not be committed.
- A resource may only be adopted if its live values are not themselves
  secret. Import writes non-secret values into state verbatim
  (`netlify_environment_variable.values[].value` is a plain string returned on
  read), so adopting a credential that a provider holds as ordinary
  configuration publishes it. Where a live resource stores a credential
  unprotected, it must be moved to the provider's secret mechanism *before*
  adoption, never after.

The invariant is currently unenforced: nothing prevents a commit whose state
decrypts to plaintext values. A check that the committed state parses as
ciphertext, and that a decrypted plan contains no credential-bearing
attribute, would make this mechanical rather than remembered.

## VRS

[requirements.md](../requirements.md) `LS.DEL.INFRA-R02`;
[spec.md](../spec.md) "Secret Handling". The requirement is kept at the target
(remote state, nothing secret committed) rather than weakened to match the
current backend.

## Implementation Contract

Enable R2 on the LiveStore Cloudflare account — blocked on a dashboard action
that cannot be scripted with the CI token; the API returns code `10042`. Then
create an R2 S3 access key, swap `backend "local"` for `backend "s3"` in
`.infra/iac/netlify/versions.tf` keeping the `encryption` block, and run
`tofu init -migrate-state`.

Close this delta when state no longer lives in the repository. Deleting the
committed state file at that point removes it from `HEAD` only; the history
entry is permanent, which is acceptable exactly as long as no `apply` wrote a
credential into it beforehand.
