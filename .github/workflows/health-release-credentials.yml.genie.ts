import { credentialEnv, releaseCredentialSurfaces } from '../../genie/release-credentials.ts'
import { bashShellDefaults, defaultActionlintConfig, githubWorkflow } from '../../genie/repo.ts'

/**
 * Weekly liveness check for the long-lived credentials the production release
 * depends on.
 *
 * A release dry-run proves today's *code* still works; it cannot prove a token
 * that expires on wall-clock time is still accepted. That is the only gap this
 * workflow fills, so it does exactly one thing: call each provider's read-only
 * token endpoint and fail loudly when a credential is rejected.
 *
 * Deliberately excluded, because these would be false confidence rather than
 * signal:
 * - No Nix/devenv setup. Every probe is an HTTP call, so there is no environment
 *   to reproduce, and approximating the release job's shell would only invite the
 *   two to drift.
 * - No tooling/PATH probes. `release.yml` runs its steps through devenv tasks; a
 *   `which pnpm` here would describe this runner, not that one.
 * - No issue filing. A failed job with the surface name and HTTP status in the log
 *   is the alert.
 *
 * What each surface is and which secrets it needs is declared once in
 * `genie/release-credentials.ts` and shared with `release.yml`, so this workflow
 * cannot verify a stale set.
 */
export default githubWorkflow({
  name: 'Health: release credentials',
  actionlint: defaultActionlintConfig,

  on: {
    schedule: [{ cron: '0 7 * * 1' }],
    workflow_dispatch: {},
  },

  // Read-only: probes never mutate provider state and nothing is written back.
  permissions: {
    contents: 'read',
  },

  jobs: {
    'verify-credentials': {
      'runs-on': 'ubuntu-24.04',
      'timeout-minutes': 10,
      defaults: bashShellDefaults,
      // No checkout: every probe is self-contained in the generated script.
      steps: releaseCredentialSurfaces.map((surface) => ({
        name: `Verify ${surface.name} credentials`,
        // Probe every surface even after one fails, so a single expired token
        // does not hide a second one behind it.
        if: '${{ !cancelled() }}',
        env: credentialEnv(surface.name),
        run: `set -euo pipefail
${surface.secrets.map((secret) => `: "\${${secret}:?Missing ${secret} — the release job needs it}"`).join('\n')}

${surface.probe}`,
      })),
    },
  },
})
