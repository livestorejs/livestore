# TodoMVC Example

See links to demos in [the examples docs](https://docs.livestore.dev/examples).

## Running locally

Note you'll also need to run the Electric server locally for the app to work (see below).

```bash
bun install
bun dev
```

### Running the Electric server locally

```bash
cd .infra
docker compose up -d
```

## Running tests

# Using bun (use 'bun run test', not 'bun test')
bun run test

# Or use bunx to run Playwright directly
bunx playwright test
```

**Note:** Use `bun run test` instead of `bun test` because Bun's test runner doesn't support Playwright's test API. The `bun run test` command executes the `playwright test` script from package.json.