# Netlify Example Deployments

LiveStore examples ship through Netlify using the `mono examples deploy` workflow. This script builds each example and pushes the assets to the correct Netlify site based on the current branch.

## Branch Behaviour

- `main` → deploys to the production site `example-<slug>` and updates the custom domain (for example `web-todomvc.livestore.dev`).
- `dev` → deploys to the dev site `example-<slug>-dev` and updates the matching dev subdomain (for example `dev.web-todomvc.livestore.dev`).
- Any other branch → deploys to the dev site `example-<slug>-dev` behind an alias (`branch-<branch>-<sha>` by default). Pass `--alias <value>` to override the alias slug, or `--prod` if you explicitly need to update production.

The script uses the directory name inside `/examples` as `<slug>` (e.g. `web-todomvc`) - not the `"name"` field from `package.json`.

## Prerequisites

- Run `direnv allow` so that `WORKSPACE_ROOT` and other helpers are available.
- Authenticate with Netlify once via `bunx netlify-cli login` or set `NETLIFY_AUTH_TOKEN` in `.envrc.local`.
- Ensure the Netlify sites exist:
  - Production: `example-<slug>` with the primary domain (e.g. `web-todomvc.livestore.dev`).
  - Dev: `example-<slug>-dev` with the dev subdomain (e.g. `dev.web-todomvc.livestore.dev`).

## Running Deployments

```bash
direnv exec . mono examples deploy            # build + deploy all supported examples
direnv exec . mono examples deploy --e web-   # deploy examples that contain "web-"
direnv exec . mono examples deploy --prod     # force a prod push regardless of branch
direnv exec . mono examples deploy --alias preview-my-change
```

The command builds in parallel (up to four examples at a time) and retries failed Netlify uploads automatically.

## Creating a New Example Site

1. Create the production site: `bunx netlify-cli sites:create --name example-<slug>`.
2. (Optional) Copy existing env vars / build settings from another example in the Netlify UI.
3. Add the production custom domain (Netlify UI → Site settings → Domain management) or via the CLI `bunx netlify-cli api updateSite --data '{"custom_domain":"<prod-domain>"}' --id <site-id>`.
4. Create the dev site: `bunx netlify-cli sites:create --name example-<slug>-dev`.
5. Attach the dev subdomain (pattern `dev.<prod-domain>`) through the UI or the same `netlify api updateSite` call against the dev site id.
6. Update `docs/src/data/examples.ts` with the new `demoUrl` and `devDemoUrl` so the docs link to both versions.

Once the sites exist, `direnv exec . mono examples deploy` takes care of the branch-specific deployments automatically.

## Troubleshooting

- `Not logged in to Netlify`: run `bunx netlify-cli status` or re-auth with `bunx netlify-cli login`.
- DNS / certificate pending: Netlify may need several minutes to issue TLS certificates after adding a new custom domain.
- To inspect the generated build output before pushing, run `pnpm build` inside the example directory.
