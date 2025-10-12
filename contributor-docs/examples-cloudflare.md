# Cloudflare Example Deployments

LiveStore examples ship via Cloudflare Workers using the `mono examples deploy` workflow. The script builds each example, deploys the corresponding Worker, and keeps the public `*.livestore.dev` domains in sync through the Vercel DNS API.

## Branch Behaviour

- `main` → builds production artifacts and deploys the Worker named `example-<slug>`. DNS for `<slug>.livestore.dev` is updated to point at the Worker (`example-<slug>.livestore.workers.dev`).
- `dev` → deploys `example-<slug>-dev` and refreshes the `dev.<slug>.livestore.dev` CNAME record.
- Any other branch → builds a preview Worker named `example-<slug>-<alias>` and leaves DNS untouched. The preview is available under `https://example-<slug>-<alias>.livestore.workers.dev`. Pass `--alias <value>` to override the generated alias or `--prod` to force a production publish.

The script uses the directory name inside `/examples` as the `<slug>` (for example `web-todomvc`).

## Prerequisites

- Run `direnv allow` so the workspace environment variables are loaded (including `WORKSPACE_ROOT`).
- Authenticate with Cloudflare:
  ```bash
  direnv exec . bunx wrangler login
  direnv exec . bunx wrangler whoami            # should list the LiveStore account
  ```
- Ensure a Cloudflare API token is available as `CLOUDFLARE_API_TOKEN` (export it via `.envrc.local` for local work and set `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` in CI secrets).
- (Optional) Authenticate with Vercel if you plan to run DNS syncing:
  ```bash
  direnv exec . bunx vercel login
  direnv exec . bunx vercel whoami              # should print the configured user
  ```
- Verify that the target Worker does not already exist or can be replaced. `mono examples deploy` does not modify DNS; use the DNS command below when you are ready to point records at a new Worker.

## Running Deployments

```bash
direnv exec . mono examples deploy              # build + deploy all configured examples
direnv exec . mono examples deploy --example-filter web-
direnv exec . mono examples deploy --prod       # force a prod push regardless of branch
direnv exec . mono examples deploy --alias preview-my-change
```

The command builds examples in parallel (three at a time) and retries Worker uploads twice. Preview Workers are not wired to DNS and remain accessible via their Workers.dev host names.

To update DNS records for production or dev environments run:

```bash
# Update production DNS for all examples
direnv exec . mono examples dns --env prod

# Update dev DNS for a subset of examples
direnv exec . mono examples dns --env dev --example-filter web-
```

The DNS command requires a `VERCEL_TOKEN` (or an interactive Vercel login) because it calls `vercel dns add/rm` under the hood.

## Creating a New Example Worker

1. Add an entry to `scripts/src/shared/cloudflare-manifest.ts` describing the example slug, Worker name, durable object bindings, and production/dev domains.
2. Ensure the example’s `package.json` has `@cloudflare/vite-plugin` and `wrangler` in `devDependencies`, plus a `wrangler.toml` with `[assets]` pointing at the built client output.
3. Add `[env.prod]` / `[env.dev]` sections (or at least unique Worker names) so the CLI can deploy prod and dev Workers independently.
4. Provision Cloudflare resources if needed (Durable Objects, D1, secrets) via `wrangler`. Update the manifest with any required metadata.
5. Run `direnv exec . mono examples deploy --example-filter <slug>` locally to verify the Worker deploys.
6. Update DNS with `direnv exec . mono examples dns --env prod --example-filter <slug>` when you are ready to point the production domain at the new Worker.
6. Update `docs/src/data/examples.ts` with the new production/dev URLs so the documentation links point to the Cloudflare deployment.

## Troubleshooting

- `wrangler deploy` fails with `Not logged in`: re-run `direnv exec . bunx wrangler login`.
- DNS updates fail with `The domain ... can't be found`: ensure `VERCEL_TOKEN` is configured (or run `bunx vercel login`) and that the token has permission to manage the `livestore.dev` domain.
- `mono examples deploy` leaves DNS untouched: confirm you are on the correct branch (only `main` and `dev` update DNS) and that the manifest lists the intended domain under the right scope (`prod` vs `dev`).
- Preview Worker unavailable: the worker is deployed at `https://<worker-name>.livestore.workers.dev`. Check `wrangler deployments list --name <worker-name>` for status.
