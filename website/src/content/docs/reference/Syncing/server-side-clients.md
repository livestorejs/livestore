---
title: Server-side clients
---

You can also use LiveStore on the server side e.g. via the `@livestore/node` adapter. This allows you to:
- have an up-to-date server-side SQLite database (read model)
- react to data changes on the server side
- run mutations on the server side

## Cloudflare Workers

- The `@livestore/node` adapter doesn't yet work with Cloudflare Workers but you can follow [this issue](https://github.com/livestorejs/livestore/issues/266) for a Cloudflare adapter to enable this use case.