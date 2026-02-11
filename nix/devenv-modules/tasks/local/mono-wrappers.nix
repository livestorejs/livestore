# Wrapper tasks that call mono commands via dt
#
# This allows uniform dt interface while keeping mono's complex logic.
# For non-trivial commands with complex TypeScript implementations,
# we wrap them as dt tasks rather than reimplementing in Nix.
#
# Benefits:
# - Uniform interface: All CI commands use `dt`
# - No regression risk: mono logic unchanged
# - Incremental migration: Can gradually move logic from mono to dt
{ ... }:
{
  tasks = {
    # =========================================================================
    # Testing
    # =========================================================================

    "test:unit" = {
      description = "Run unit tests";
      exec = "mono test unit";
    };

    "test:perf" = {
      description = "Run performance tests";
      exec = "mono test perf";
    };

    # Integration test suites
    "test:integration:misc" = {
      description = "Run misc integration tests";
      exec = "mono test integration misc";
    };

    "test:integration:todomvc" = {
      description = "Run todomvc integration tests";
      exec = "mono test integration todomvc";
    };

    "test:integration:devtools" = {
      description = "Run devtools integration tests";
      exec = "mono test integration devtools";
    };

    "test:integration:wa-sqlite" = {
      description = "Run wa-sqlite tests";
      exec = "mono test integration wa-sqlite";
    };

    "test:integration:node-sync" = {
      description = "Run node-sync tests";
      exec = "mono test integration node-sync";
    };

    # Sync provider tests (individual providers for CI matrix)
    "test:integration:sync-provider" = {
      description = "Run all sync provider tests";
      exec = "mono test integration sync-provider";
    };

    "test:integration:sync-provider:mock" = {
      description = "Run mock sync provider tests";
      exec = "mono test integration sync-provider --provider mock";
    };

    "test:integration:sync-provider:electric" = {
      description = "Run electric sync provider tests";
      exec = "mono test integration sync-provider --provider electric";
    };

    "test:integration:sync-provider:s2" = {
      description = "Run s2 sync provider tests";
      exec = "mono test integration sync-provider --provider s2";
    };

    "test:integration:sync-provider:cf-http-d1" = {
      description = "Run cf-http-d1 sync provider tests";
      exec = "mono test integration sync-provider --provider cf-http-d1";
    };

    "test:integration:sync-provider:cf-http-do" = {
      description = "Run cf-http-do sync provider tests";
      exec = "mono test integration sync-provider --provider cf-http-do";
    };

    "test:integration:sync-provider:cf-ws-d1" = {
      description = "Run cf-ws-d1 sync provider tests";
      exec = "mono test integration sync-provider --provider cf-ws-d1";
    };

    "test:integration:sync-provider:cf-ws-do" = {
      description = "Run cf-ws-do sync provider tests";
      exec = "mono test integration sync-provider --provider cf-ws-do";
    };

    "test:integration:sync-provider:cf-do-rpc-d1" = {
      description = "Run cf-do-rpc-d1 sync provider tests";
      exec = "mono test integration sync-provider --provider cf-do-rpc-d1";
    };

    "test:integration:sync-provider:cf-do-rpc-do" = {
      description = "Run cf-do-rpc-do sync provider tests";
      exec = "mono test integration sync-provider --provider cf-do-rpc-do";
    };

    # =========================================================================
    # Docs
    # =========================================================================

    "docs:dev" = {
      description = "Start docs dev server";
      exec = "mono docs dev";
    };

    "docs:build" = {
      description = "Build docs";
      exec = "mono docs build";
    };

    "docs:build:api" = {
      description = "Build docs with API docs";
      exec = "mono docs build --api-docs";
    };

    "docs:deploy" = {
      description = "Deploy docs";
      exec = "mono docs deploy";
    };

    # =========================================================================
    # Examples
    # =========================================================================

    "examples:test" = {
      description = "Test examples";
      exec = "mono examples test";
    };

    "examples:deploy" = {
      description = "Deploy examples to Cloudflare";
      exec = "mono examples deploy";
    };

    # =========================================================================
    # Release
    # =========================================================================

    "release:snapshot" = {
      description = "Publish snapshot release to npm";
      exec = "mono release snapshot";
    };

    # =========================================================================
    # Lint (dt-native)
    # =========================================================================

    "lint:check:madge" = {
      description = "Check circular dependencies with madge";
      exec = "./scripts/node_modules/.bin/madge --circular --no-spinner examples/*/src packages/*/*/src";
      after = [ "pnpm:install" ];
    };

    "lint:check:md-imports" = {
      description = "Check markdown files for ESM imports";
      exec = ''
        set -euo pipefail
        matches=$(grep -rl '^import ' docs/src/content/docs --include='*.md' 2>/dev/null || true)
        violations=$(printf '%s\n' "$matches" | grep -v '^docs/src/content/docs/api/' || true)

        if [ -n "$violations" ]; then
          echo "Error: Found .md files with import statements. These must be renamed to .mdx:"
          printf '%s\n' "$violations" | while IFS= read -r path; do
            [ -n "$path" ] && echo "  - $path"
          done
          exit 1
        fi
      '';
    };

    "lint:full" = {
      description = "Run full lint checks (lint:check + madge + markdown import guard)";
      after = [
        "lint:check"
        "lint:check:madge"
        "lint:check:md-imports"
      ];
    };

    "lint:full:fix" = {
      description = "Fix lint issues, then run full lint checks";
      after = [
        "lint:fix"
        "lint:check:madge"
        "lint:check:md-imports"
      ];
    };
  };
}
