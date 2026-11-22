# Integration tests

## DevTools artifacts

Run `bun tests/integration/scripts/run-tests.ts devtools --workers 1` from the
repository root inside `devenv shell`. `--grep <pattern>` selects scenarios.
The default fixture retains the app's normal package version.

Set `LIVESTORE_TEST_DEVTOOLS_VERSION_SKEW=1` to give the app and all its real
workers a synthetic package version while retaining protocol 1. The web single-tab
scenarios select a real advertised session and require the Database tab and app
data to render, exercising the artifact's independent UI-state store boot.

```sh
LIVESTORE_TEST_DEVTOOLS_VERSION_SKEW=1 bun tests/integration/scripts/run-tests.ts \
  devtools --grep 'package version skew' --workers 1
```

The existing `test:integration:playwright:suite` CI task runs the unchanged
normal suite first, then just these two web scenarios with skew enabled. The
second pass writes its HTML report beneath `playwright-report/version-skew` and
its traces beneath `test-results/devtools-version-skew`, preserving the normal
suite's evidence. The full suite is not duplicated.

Before publication, use `--artifact-manifest <file>` with a schema-version-2
manifest whose metadata, tarball, and Chrome ZIP locators are local absolute
paths. Include exact tarball and ZIP SHA-256 values as in
`release/devtools-artifact.json`; normal verification and extraction still apply.
Without this option, the checked-in release manifest is used. The exported
`runDevtoolsTest` also defaults these optional settings internally, so existing
`mono test integration devtools|all` callers retain their original behavior.
