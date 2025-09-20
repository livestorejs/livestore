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

## TypeScript

- Avoid `as any`, force-casting etc as much as possible.

## Git

- Before committing, run `direnv exec . mono lint --fix` to auto-fix most linting errors. Make sure there are no type check/lint errors.

### Branch Naming Conventions

- Use descriptive branch names that clearly indicate the purpose: `feat/add-user-auth`, `fix/memory-leak`, `docs/api-reference`
- Keep branch names concise but specific (under 30 characters when possible)
- Use kebab-case for consistency

### Development Workflow

- Create feature branches from `dev` branch: `git checkout -b feat/my-feature dev`
- Run the full test suite before pushing: `direnv exec . mono test unit`
- Ensure TypeScript compilation passes: `direnv exec . mono ts`
- Use `direnv exec . mono lint --fix` to automatically fix formatting issues

### Environment Variables

- Copy environment variable examples from `.envrc` comments to your `.envrc.local` file
- Required for docs development: `MXBAI_API_KEY` and `MXBAI_VECTOR_STORE_ID`
- Never commit sensitive environment variables to the repository