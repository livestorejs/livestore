# Project-Specific Instructions for Claude

## Setup

This repository uses [`direnv`](https://direnv.net) for automatic environment setup. Run `direnv allow` once, then direnv automatically runs the setup script which installs dependencies and builds TypeScript.

## Tooling

- When tools are not directly available in `$PATH`, prefix commands with `direnv exec .` (e.g. `direnv exec . tsc`, `direnv exec . mono lint`)

- For depedency management see @contributor-docs/dependency-management.md

### `mono` CLI

Use the `mono` CLI for common workflows:
- `mono lint` / `mono lint --fix` to run the linting checks
- `mono test <unit|integration|perf>` to run the tests
  - Some tests can take a while to run.
- `mono ts [--watch] [--clean]` to build the TypeScript code
- `mono docs <dev|build|deploy>` for docs workflows
- `mono examples <run|deploy>` for example workflows
- ... and more

## Testing

- When working on specific Vitest tests, use the `vitest` CLI directly instead of `mono test` and make sure to target the specific test file and test name: e.g. `vitest run packages/@livestore/common/src/index.test.ts --testNamePattern "should be able to get the number of users"`.
