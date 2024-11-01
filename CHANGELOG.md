# Changelog

> NOTE: LiveStore is still in alpha and releases can include breaking changes. See [state of the project](https://preview.livestore.dev/reference/state-of-the-project/) for more info.

## 0.0.58

- Prepared the foundations for the upcoming [rebase sync protocol](https://github.com/livestorejs/livestore/issues/195)
  - New event id strategy (uses a global event id integer sequence number)
- Breaking: Changed `schema.key` to `storeId`
- Breaking: Updated storage format version to 2
- Upgraded dependencies
  - If you're using `effect` in your project, make sure to install version `3.10.x`
		- Note the new version of `effect` now includes `Schema` directly, so `@effect/schema` is no longer needed as a separate dependency. (See [Effect blog post](https://effect.website/blog/releases/effect/310/#effectschema-moved-to-effectschema).)

### Web adapter

- Devtools address is now automatically logged during development making connecting easier.

![](https://i.imgur.com/nmkS9yR.png)

### Devtools

- New SQLite query playground