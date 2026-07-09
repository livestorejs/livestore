# Vendored overeng oxlint plugin

This directory vendors the runtime source for the `@overeng/oxc-config` oxlint
plugin so LiveStore can run oxlint without package-manager-provided plugin injection.

Node.js can load these `.ts` files directly because they live outside
`node_modules`. Once `@overeng/oxc-config` is published to npm with a JavaScript
plugin artifact, replace this vendored copy with a normal package dependency and
point `.oxlintrc.json#jsPlugins` at the published artifact.

Source snapshot:

- Repository: `overengineeringstudio/effect-utils`
- Commit: `4f04a80a2c1f8440511283c52fb40ba65fd961a6`
- Package path: `packages/@overeng/oxc-config/src`
