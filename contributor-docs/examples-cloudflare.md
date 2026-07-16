# Cloudflare Example Deployments

> Companion of the intent-layer node
> [`context/04-docs/01-examples/`](../context/04-docs/01-examples/spec.md),
> which owns the example-deployment contract (LS.DOCS.EX-R04).

LiveStore examples ship via Cloudflare Workers using the `mono examples deploy` workflow. The script builds each example and deploys the corresponding Worker. Each deployment is reachable via its `*.livestore.workers.dev` hostname—no additional DNS step is required.

## Branch Behaviour

- `main` → deploys the dev Worker named `example-<slug>-dev`, served at `https://example-<slug>-dev.livestore.workers.dev`.
- Pull requests and feature branches → build the shared preview Worker named `example-<slug>-preview`, available at `https://example-<slug>-preview.livestore.workers.dev`.
- Stable release publishing → passes `--prod`, deploys the Worker named `example-<slug>`, and serves it at `https://example-<slug>.livestore.workers.dev`.

The script uses the directory name inside `/examples` as the `<slug>` (for example `web-todomvc`).

## Prerequisites

- Run `direnv allow` so the workspace environment variables are loaded (including `WORKSPACE_ROOT`).
- Authenticate with Cloudflare:
  ```bash
  direnv exec . bunx wrangler login
  direnv exec . bunx wrangler whoami            # should list the LiveStore account
  ```
- (Optional) A Cloudflare API token (`CLOUDFLARE_API_TOKEN`) allows headless deploys in CI, but interactive work only requires `wrangler login`.
- Verify that the target Worker does not already exist or can be replaced. `mono examples deploy` emits the Workers.dev URL so you can sanity-check the new build.

## Running Deployments

```bash
direnv exec . mono examples deploy              # build + deploy all configured examples
direnv exec . mono examples deploy --example-filter web-
direnv exec . mono examples deploy --prod       # stable release versions only
direnv exec . mono examples validate-links      # verify published prod/dev demo URLs
```

The deploy command builds examples in parallel (three at a time) and retries Worker uploads twice. Preview Workers are accessible exclusively via their Workers.dev host names. The validation command checks the repo-owned public deployment metadata in `packages/@local/shared/src/example-deployments.ts` without following redirects, so intentional route redirects such as LinearLite remain visible.

## Creating a New Example Worker

1. Add an entry to `scripts/src/shared/cloudflare-manifest.ts` describing the example slug, Worker name, Durable Object bindings, and production/dev domains.
2. Ensure the example’s `package.json` has `@cloudflare/vite-plugin` and `wrangler` in `devDependencies`, plus a `wrangler.toml` with `[assets]` pointing at the built client output.
3. Add `[env.prod]`, `[env.preview]`, and `[env.dev]` sections in `wrangler.toml`; duplicate any bindings (Durable Objects, D1, queues, secrets, etc.) inside each environment block because Wrangler does not inherit them automatically.
4. Provision Cloudflare resources if needed (Durable Objects, D1, secrets) via `wrangler`. Update the manifest with any required metadata.
5. Run `direnv exec . mono examples deploy --example-filter <slug>` locally to verify the Worker deploys.
6. Add the public prod/dev URL contract to `packages/@local/shared/src/example-deployments.ts` when the example should be linked from docs.
7. Update `docs/src/data/examples.ts` to consume the shared deployment entry instead of hard-coding URLs.
8. Run `direnv exec . mono examples validate-links --example-filter <slug>` to verify the public demo endpoints.

## Troubleshooting

- `wrangler deploy` fails with `Not logged in`: re-run `direnv exec . bunx wrangler login`.
- Preview Worker unavailable: the worker is deployed at `https://<worker-name>.livestore.workers.dev`. Check `wrangler deployments list --name <worker-name>` for status.
