# Scripts

## Standalone scripts

Standalone scripts can't have any Node dependencies yet.

## Source scripts

Source scripts can have Node dependencies.

## DevTools artifact integration

Run `bun tests/integration/scripts/run-tests.ts devtools --workers 1` from the
repository root inside `devenv shell`. `--grep <pattern>` selects scenarios.
The fixture deliberately gives the app and all its workers a synthetic package
version while retaining protocol 1; the selected-session tests must still render
the Database tab using the artifact's independently booted UI-state store.

Before publication, use `--artifact-manifest <file>` with a schema-version-2
manifest whose metadata, tarball, and Chrome ZIP locators are local absolute
paths. Include the exact tarball and ZIP SHA-256 values, as in
`release/devtools-artifact.json`; the normal verification and extraction path
still applies. Without this option, the checked-in release manifest is used.
