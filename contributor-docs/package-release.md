# Package Release Guide

## npm publishConfig Limitations

**Problem:** npm does not support overriding the `sideEffects` field through `publishConfig` ([npm CLI Issue #7586](https://github.com/npm/cli/issues/7586) - explicitly rejected).

**Workaround:** Include both source and dist paths in the top-level `sideEffects` field instead of using `publishConfig.sideEffects`. Only one path will exist in any given context (development vs published), so both are safe to include.