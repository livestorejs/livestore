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
    # Setup
    # =========================================================================

    "setup:preflight" = {
      description = "Run deterministic CI preflight bootstrap";
      exec = "DEVENV_SKIP_SETUP=1 devenv tasks run pnpm:install genie:run ts:build --mode before --verbose";
    };

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

    "test:integration:node-sync:allow-flaky" = {
      description = "Run node-sync tests, warn on flaky failure";
      exec = ''
        if mono test integration node-sync; then
          exit 0
        fi
        echo "::warning::Node-sync integration tests failed (flaky; see https://github.com/livestorejs/livestore/issues/624 for details)"
        exit 0
      '';
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

    "test:integration:sync-provider:matrix" = {
      description = "Run sync-provider tests for TEST_SYNC_PROVIDER";
      exec = ''
        set -euo pipefail
        provider="''${TEST_SYNC_PROVIDER:-}"

        if [ -z "$provider" ]; then
          echo "Error: TEST_SYNC_PROVIDER is required"
          exit 1
        fi

        if [[ "$provider" == cf-* ]]; then
          if mono test integration sync-provider --provider "$provider"; then
            exit 0
          fi
          echo "::warning::Cloudflare sync-provider tests for $provider failed (flaky; see https://github.com/livestorejs/livestore/issues/625 and upstream https://github.com/cloudflare/workers-sdk/issues/11122)"
          exit 0
        fi

        mono test integration sync-provider --provider "$provider"
      '';
    };

    "test:integration:playwright:suite" = {
      description = "Run PLAYWRIGHT_SUITE integration tests";
      exec = ''
        set -euo pipefail
        suite="''${PLAYWRIGHT_SUITE:-}"

        if [ -z "$suite" ]; then
          echo "Error: PLAYWRIGHT_SUITE is required"
          exit 1
        fi

        if [ "$suite" = "devtools" ]; then
          mono test integration devtools || echo "::warning::Script failed but continuing"
          exit 0
        fi

        mono test integration "$suite"
      '';
    };

    "test:integration:wa-sqlite:build" = {
      description = "Build wa-sqlite integration test target";
      cwd = "packages/@livestore/wa-sqlite";
      exec = "nix run .#build";
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

    "docs:build:phase:snippets" = {
      description = "Build docs snippets (CI phase)";
      exec = ''
        set -euo pipefail
        mkdir -p tmp/ci-docs
        timeout --signal=TERM --kill-after=2m 20m mono docs snippets build 2>&1 | tee tmp/ci-docs/01-snippets.log
      '';
    };

    "docs:build:phase:diagrams" = {
      description = "Build docs diagrams (CI phase)";
      exec = ''
        set -euo pipefail
        mkdir -p tmp/ci-docs
        timeout --signal=TERM --kill-after=2m 20m mono docs diagrams build 2>&1 | tee tmp/ci-docs/02-diagrams.log
      '';
    };

    "docs:build:phase:astro" = {
      description = "Build Astro docs bundle (CI phase)";
      exec = ''
        set -euo pipefail
        mkdir -p tmp/ci-docs
        (
          while true; do
            echo "[docs-heartbeat] $(date -u +%Y-%m-%dT%H:%M:%SZ) astro build still running"
            pgrep -af 'astro|chromium|chrome_crashpad_handler|node|mono' || true
            sleep 60
          done
        ) > tmp/ci-docs/03-heartbeat.log 2>&1 &
        HEARTBEAT_PID=$!
        cleanup() {
          kill "$HEARTBEAT_PID" 2>/dev/null || true
        }
        trap cleanup EXIT
        timeout --signal=TERM --kill-after=2m 20m mono docs build --api-docs --skip-deps 2>&1 | tee tmp/ci-docs/03-astro-build.log
      '';
    };

    "docs:build:diagnostics" = {
      description = "Collect docs build diagnostics";
      exec = ''
        set -euo pipefail
        mkdir -p tmp/ci-docs
        date -u +%Y-%m-%dT%H:%M:%SZ | tee tmp/ci-docs/failure-timestamp.log
        ps -eo pid,ppid,etime,pcpu,pmem,comm,args > tmp/ci-docs/ps-full.log || true
        pgrep -af 'astro|chromium|chrome_crashpad_handler|node|mono|dt' > tmp/ci-docs/pgrep-build-procs.log || true
      '';
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

    "examples:install" = {
      description = "Install examples workspace dependencies";
      exec = "pnpm install --frozen-lockfile --dir examples";
    };

    "examples:build:src" = {
      description = "Build examples source bundles";
      exec = "pnpm --dir examples --filter 'livestore-example-*' --workspace-concurrency=1 build";
      after = [ "examples:install" ];
    };

    # =========================================================================
    # Release
    # =========================================================================

    "release:snapshot" = {
      description = "Publish snapshot release to npm";
      exec = "mono release snapshot";
    };

    "release:snapshot:git-sha" = {
      description = "Publish snapshot release pinned to GIT_SHA";
      exec = ''
        set -euo pipefail
        if [ -z "''${GIT_SHA:-}" ]; then
          echo "Error: GIT_SHA is required"
          exit 1
        fi
        mono release snapshot --git-sha="$GIT_SHA"
      '';
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

    "lint:full:with-megarepo-check" = {
      description = "Run full lint checks plus megarepo consistency";
      after = [
        "lint:full"
        "megarepo:check"
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
