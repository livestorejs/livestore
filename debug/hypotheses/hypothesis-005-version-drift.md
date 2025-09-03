Hypothesis H005: Version drift (wrangler/workerd/node/bun/pnpm) affects behavior

Statement
- Version differences between local and CI environments change sync timing or protocol behavior.

Signals to collect
- CI prints versions of node/bun/pnpm/wrangler/workerd; compare with local.
- Reproduce locally with the same versions and nix shell to match CI.

Acceptance criteria
- Confirmed if pinning versions to match local eliminates CI-only failures, or specific version change correlates with failures.
- Falsified if failures persist across matched versions.

Remediation
- Pin or bump specific tool versions in Nix flake/lock and CI setup.

