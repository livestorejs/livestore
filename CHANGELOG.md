# Changelog

## 0.0.58

- Prepared the foundations for the upcoming [rebase sync protocol](https://github.com/livestorejs/livestore/issues/195)
- Breaking: Changed `schema.key` to `storeId`
- Upgraded dependencies
  - If you're using `effect` in your project, make sure to install version `3.10.x`
		- Note the new version of `effect` now includes `Schema` directly, so `@effect/schema` is no longer needed as a separate dependency. (See [Effect blog post](https://effect.website/blog/releases/effect/310/#effectschema-moved-to-effectschema).)

### Devtools

- New SQLite query playground