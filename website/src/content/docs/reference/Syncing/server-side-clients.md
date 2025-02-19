---
title: Server-side clients
---

You can also use LiveStore on the server side e.g. via the `@livestore/adapter-node` adapter. This allows you to:
- have an up-to-date server-side SQLite database (read model)
- react to data changes on the server side
- run mutations on the server side

## Cloudflare Workers

- The `@livestore/adapter-node` adapter doesn't yet work with Cloudflare Workers but you can follow [this issue](https://github.com/livestorejs/livestore/issues/266) for a Cloudflare adapter to enable this use case.