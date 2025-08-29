# Project-Specific Instructions for Claude

## Tooling

- When tools are not directly available in `$PATH`, prefix commands with `direnv exec .` (e.g. `direnv exec . tsc`, `direnv exec . biome check`)

- For depedency management see @contributor-docs/dependency-management.md

## Testing

- When working on Vitest tests, use the `vitest` CLI directly instead of `pnpm test` and make sure to target the specific test file and test name.
