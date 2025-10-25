# Cloudflare Example Deployments

LiveStore examples ship via Cloudflare Workers using the `mono examples deploy` workflow. The script builds each example and deploys the corresponding Worker. Each deployment is reachable via its `*.livestore.workers.dev` hostname—no additional DNS step is required.

## Branch Behaviour

- `main` → builds production artifacts and deploys the Worker named `example-<slug>`, served at `https://example-<slug>.livestore.workers.dev`.
- `dev` → deploys `example-<slug>-dev`, served at `https://example-<slug>-dev.livestore.workers.dev`.
- Any other branch → builds the shared preview Worker named `example-<slug>-preview`, available at `https://example-<slug>-preview.livestore.workers.dev`. Use `--prod` to force a production publish when working on a feature branch.

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
direnv exec . mono examples deploy --prod       # force a prod push regardless of branch
```

The command builds examples in parallel (three at a time) and retries Worker uploads twice. Preview Workers are accessible exclusively via their Workers.dev host names.

## Creating a New Example Worker

1. Add an entry to `scripts/src/shared/cloudflare-manifest.ts` describing the example slug, Worker name, durable object bindings, and production/dev domains.
2. Ensure the example’s `package.json` has `@cloudflare/vite-plugin` and `wrangler` in `devDependencies`, plus a `wrangler.toml` with `[assets]` pointing at the built client output.
3. Add `[env.prod]`, `[env.preview]`, and `[env.dev]` sections in `wrangler.toml`; duplicate any bindings (Durable Objects, D1, queues, secrets, etc.) inside each environment block because Wrangler does not inherit them automatically.
4. Provision Cloudflare resources if needed (Durable Objects, D1, secrets) via `wrangler`. Update the manifest with any required metadata.
5. Run `direnv exec . mono examples deploy --example-filter <slug>` locally to verify the Worker deploys.
6. Update `docs/src/data/examples.ts` with the new production/dev URLs so the documentation links point to the Cloudflare deployment.

## Troubleshooting

- `wrangler deploy` fails with `Not logged in`: re-run `direnv exec . bunx wrangler login`.
- Preview Worker unavailable: ensure the deploy succeeded and visit `https://example-<slug>-preview.livestore.workers.dev`. Check `wrangler deployments list --name <worker-name>` for status.
- Preview Worker unavailable: the worker is deployed at `https://<worker-name>.livestore.workers.dev`. Check `wrangler deployments list --name <worker-name>` for status.
