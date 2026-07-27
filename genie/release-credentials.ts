/**
 * External credential surfaces the production release depends on.
 *
 * Single source of truth, in the same spirit as `ci.ts`: `release.yml` derives the
 * `env:` blocks its production deploy steps pass through to devenv tasks, and
 * `health-release-credentials.yml` derives what it probes. Declaring a surface here
 * is the only way to give a release step a credential, so the probe cannot fall
 * behind what a release actually needs, and a mistyped secret name cannot appear in
 * one place but not the other.
 *
 * npm is deliberately absent: publishing authenticates through OIDC trusted
 * publishing (`release.yml` asserts no `NPM_TOKEN`/`NODE_AUTH_TOKEN` is set), so
 * there is no long-lived npm credential to expire.
 */

export type TCredentialSurface = {
  /** Human-readable surface name, used in probe output. */
  readonly name: string
  /** Secrets the release step receives and the probe requires. */
  readonly secrets: readonly [string, ...string[]]
  /**
   * Read-only API call proving the credentials are still accepted.
   *
   * Runs under `set -euo pipefail` with the surface's secrets in the environment.
   * Must exit non-zero when a credential is rejected. Read-only by construction —
   * a liveness probe must never mutate production state.
   */
  readonly probe: string
}

/**
 * Fail on anything other than the expected status so an expired or revoked token
 * (401/403) is a hard failure rather than a warning that scrolls past.
 */
const curlStatusProbe = ({ url, header }: { url: string; header: string }) =>
  // No --location: following a redirect would replay the Authorization header to
  // whatever host the redirect names.
  `status=$(curl --silent --show-error --max-time 30 --output /dev/null --write-out '%{http_code}' --header "${header}" "${url}")
if [ "$status" != "200" ]; then
  echo "::error::credential rejected (HTTP $status)"
  exit 1
fi
echo "credential accepted (HTTP $status)"`

export const releaseCredentialSurfaces = [
  {
    name: 'Netlify',
    secrets: ['NETLIFY_AUTH_TOKEN'],
    // `/user` validates the token itself without coupling the probe to a site id.
    probe: curlStatusProbe({
      url: 'https://api.netlify.com/api/v1/user',
      header: 'Authorization: Bearer $NETLIFY_AUTH_TOKEN',
    }),
  },
  {
    name: 'Cloudflare',
    secrets: ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'],
    // `/user/tokens/verify` reports token *status*, so a token that still
    // authenticates but has expired or been disabled is caught rather than passing.
    probe: `response=$(curl --silent --show-error --max-time 30 \\
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \\
  https://api.cloudflare.com/client/v4/user/tokens/verify)
token_status=$(printf '%s' "$response" | jq -r '.result.status // empty')
if [ "$token_status" != "active" ]; then
  echo "::error::Cloudflare token status is '\${token_status:-unknown}', expected 'active'"
  exit 1
fi
account_status=$(curl --silent --show-error --max-time 30 --output /dev/null --write-out '%{http_code}' \\
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \\
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID")
if [ "$account_status" != "200" ]; then
  echo "::error::CLOUDFLARE_ACCOUNT_ID not readable with this token (HTTP $account_status)"
  exit 1
fi
echo "credential accepted (token active, account readable)"`,
  },
  {
    name: 'Mixedbread',
    secrets: ['MXBAI_API_KEY', 'MXBAI_VECTOR_STORE_ID_PROD'],
    // Probing the specific store validates both the key and the store id, which is
    // the pair `docs:search:sync:prod` actually needs. Docs surfaces have separate
    // indexes (#1507); this surface covers the prod one, which is what a release uses.
    probe: curlStatusProbe({
      url: 'https://api.mixedbread.com/v1/vector_stores/$MXBAI_VECTOR_STORE_ID_PROD',
      header: 'Authorization: Bearer $MXBAI_API_KEY',
    }),
  },
] as const satisfies readonly TCredentialSurface[]

/** Look up a declared surface, failing generation rather than emitting a silent typo. */
export const credentialSurface = (name: string): TCredentialSurface => {
  const surface = releaseCredentialSurfaces.find((candidate) => candidate.name === name)
  if (surface === undefined) {
    throw new Error(
      `Unknown credential surface "${name}". Declared: ${releaseCredentialSurfaces.map((s) => s.name).join(', ')}`,
    )
  }
  return surface
}

/** `env:` block wiring a surface's secrets into a workflow step. */
export const credentialEnv = (...names: readonly string[]): Record<string, string> =>
  Object.fromEntries(
    names
      .map(credentialSurface)
      .flatMap((surface) => surface.secrets.map((secret) => [secret, `\${{ secrets.${secret} }}`])),
  )
