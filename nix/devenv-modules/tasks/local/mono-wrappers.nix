# Wrapper tasks that expose package scripts through dt
#
# This keeps package.json as the command entrypoint surface while preserving
# devenv task dependencies, status checks, and the existing dt task names.
#
# Benefits:
# - Uniform interface: All CI commands use `dt`
# - Package scripts are directly runnable with `pnpm run <task>`
# - Nix stays responsible for environment/dependency wiring, not task bodies
{
  inputs,
  lib,
  pkgs,
  ...
}:
let
  pnpm = "${inputs.effect-utils.lib.mkPnpm { inherit pkgs; }}/bin/pnpm";
  pnpmRun = task: "${pnpm} run ${lib.escapeShellArg task}";
in
{
  tasks = {
    # =========================================================================
    # Testing
    # =========================================================================

    # CI bootstrap for heavy jobs:
    # keep setup strict via task dependencies instead of a separate preflight step.
    # TODO: simplify once nested devenv task failures are fixed upstream:
    # https://github.com/cachix/devenv/issues/2512

    "test:unit" = {
      description = "Run unit tests";
      exec = pnpmRun "test:unit";
      after = [ "setup:strict" ];
    };

    "test:perf" = {
      description = "Run performance tests";
      exec = pnpmRun "test:perf";
      after = [ "setup:strict" ];
    };

    # Integration test suites
    "test:integration:misc" = {
      description = "Run misc integration tests";
      exec = pnpmRun "test:integration:misc";
    };

    "test:integration:todomvc" = {
      description = "Run todomvc integration tests";
      exec = pnpmRun "test:integration:todomvc";
    };

    "test:integration:devtools" = {
      description = "Run devtools integration tests";
      exec = pnpmRun "test:integration:devtools";
    };

    "test:integration:wa-sqlite" = {
      description = "Run wa-sqlite tests";
      exec = pnpmRun "test:integration:wa-sqlite";
    };

    # Sync provider tests (individual providers for CI matrix)
    "test:integration:sync-provider" = {
      description = "Run all sync provider tests";
      exec = pnpmRun "test:integration:sync-provider";
    };

    "test:integration:sync-provider:mock" = {
      description = "Run mock sync provider tests";
      exec = pnpmRun "test:integration:sync-provider:mock";
    };

    "test:integration:sync-provider:cf-http-d1" = {
      description = "Run cf-http-d1 sync provider tests";
      exec = pnpmRun "test:integration:sync-provider:cf-http-d1";
    };

    "test:integration:sync-provider:cf-http-do" = {
      description = "Run cf-http-do sync provider tests";
      exec = pnpmRun "test:integration:sync-provider:cf-http-do";
    };

    "test:integration:sync-provider:cf-ws-d1" = {
      description = "Run cf-ws-d1 sync provider tests";
      exec = pnpmRun "test:integration:sync-provider:cf-ws-d1";
    };

    "test:integration:sync-provider:cf-ws-do" = {
      description = "Run cf-ws-do sync provider tests";
      exec = pnpmRun "test:integration:sync-provider:cf-ws-do";
    };

    "test:integration:sync-provider:cf-do-rpc-d1" = {
      description = "Run cf-do-rpc-d1 sync provider tests";
      exec = pnpmRun "test:integration:sync-provider:cf-do-rpc-d1";
    };

    "test:integration:sync-provider:cf-do-rpc-do" = {
      description = "Run cf-do-rpc-do sync provider tests";
      exec = pnpmRun "test:integration:sync-provider:cf-do-rpc-do";
    };

    "test:integration:sync-provider:matrix" = {
      description = "Run sync-provider tests for TEST_SYNC_PROVIDER";
      exec = pnpmRun "test:integration:sync-provider:matrix";
      after = [ "setup:strict" ];
    };

    "test:integration:playwright:suite" = {
      description = "Run PLAYWRIGHT_SUITE integration tests";
      exec = pnpmRun "test:integration:playwright:suite";
      after = [ "setup:strict" ];
    };

    "test:integration:playwright:upload-trace" = {
      description = "Upload Playwright report to Netlify for PLAYWRIGHT_SUITE";
      exec = pnpmRun "test:integration:playwright:upload-trace";
      after = [ "setup:strict" ];
    };

    "test:integration:wa-sqlite:build" = {
      description = "Build wa-sqlite integration test target";
      exec = pnpmRun "test:integration:wa-sqlite:build";
      after = [ "setup:strict" ];
    };

    # =========================================================================
    # Docs
    # =========================================================================

    "docs:dev" = {
      description = "Start docs dev server";
      exec = pnpmRun "docs:dev";
    };

    "docs:build" = {
      description = "Build docs";
      exec = pnpmRun "docs:build";
    };

    "docs:build:api" = {
      description = "Build docs with API docs";
      exec = pnpmRun "docs:build:api";
    };

    "docs:deploy" = {
      description = "Deploy docs";
      exec = pnpmRun "docs:deploy";
    };

    "docs:deploy:prod" = {
      description = "Build and deploy production docs";
      exec = pnpmRun "docs:deploy:prod";
    };

    # =========================================================================
    # Docs prod deploy — phase split ("Option A")
    #
    # The prod deploy is hoisted into deploy-prod.yml, where each phase runs as a
    # separate job (or step) wrapped in an OS-level `timeout(1)` + heartbeat. The
    # rationale is structural: the tldraw renderer (@kitschpatrol/tldraw-cli →
    # Puppeteer) can leave an orphan Chromium child after the build, and that
    # child has previously kept the deploy step hanging for hours
    # (livestorejs/livestore#1279). Capping each phase at the OS boundary makes
    # that hang both visible and recoverable without losing prior phase output.
    #
    # Option A collapses the former snippets → diagrams → astro → upload phases
    # into a single `build-deploy` step: `netlify deploy --build` (see
    # `scripts/src/shared/netlify.ts`) runs the full `@netlify/build` pipeline,
    # which builds the framework (auto-building snippets/diagrams) AND bundles the
    # serverless + edge functions in one bounded step. The build still spawns
    # chromium for mermaid, so the chromium-isolation intent of #1283 is honored
    # by keeping it within this one timeout-wrapped phase.
    #
    # Phase contract:
    # - build-deploy: `mono docs deploy --prod --step=upload`. Builds + deploys
    #   via the Netlify CLI and writes deploy IDs to
    #   `tmp/ci-docs-prod/deploy-state.json` for verify/purge.
    # - verify: `mono docs deploy --prod --step=verify`. Reads state, posts the
    #   GitHub job summary + workflow report. Markdown probe is non-fatal.
    # - purge: `mono docs deploy --prod --step=purge`. Reads state, purges the
    #   Netlify CDN cache. Failure is non-fatal — the deploy is already live.
    # =========================================================================

    "docs:deploy:prod:phase:build-deploy" = {
      description = "Build + deploy prod docs to Netlify via Option A (CI phase, writes state file)";
      exec = pnpmRun "docs:deploy:prod:phase:build-deploy";
      after = [ "setup:strict" ];
    };

    "docs:deploy:prod:phase:verify" = {
      description = "Verify prod docs deploy (CI phase, reads state file)";
      exec = pnpmRun "docs:deploy:prod:phase:verify";
    };

    "docs:deploy:prod:phase:purge" = {
      description = "Purge prod docs Netlify CDN cache (CI phase, reads state file)";
      exec = pnpmRun "docs:deploy:prod:phase:purge";
    };

    "docs:search:sync:prod" = {
      description = "Sync prod Mixedbread vector store from docs Markdown sources";
      exec = pnpmRun "docs:search:sync:prod";
      after = [ "pnpm:install" ];
    };

    "docs:deploy:prod:diagnostics" = {
      description = "Collect prod docs deploy diagnostics on failure";
      exec = pnpmRun "docs:deploy:prod:diagnostics";
    };

    "docs:build:phase:snippets" = {
      description = "Build docs snippets (CI phase)";
      exec = pnpmRun "docs:build:phase:snippets";
      after = [ "setup:strict" ];
    };

    "docs:build:phase:diagrams" = {
      description = "Build docs diagrams (CI phase)";
      exec = pnpmRun "docs:build:phase:diagrams";
    };

    "docs:build:phase:astro" = {
      description = "Build Astro docs bundle (CI phase)";
      exec = pnpmRun "docs:build:phase:astro";
    };

    "docs:build:diagnostics" = {
      description = "Collect docs build diagnostics";
      exec = pnpmRun "docs:build:diagnostics";
    };

    # =========================================================================
    # Examples
    # =========================================================================

    "examples:test" = {
      description = "Test examples";
      exec = pnpmRun "examples:test";
    };

    "examples:deploy" = {
      description = "Deploy examples to Cloudflare";
      exec = pnpmRun "examples:deploy";
    };

    "examples:deploy:prod" = {
      description = "Deploy examples to production Cloudflare Workers";
      exec = pnpmRun "examples:deploy:prod";
    };

    "examples:validate-links" = {
      description = "Validate hosted example links";
      exec = pnpmRun "examples:validate-links";
    };

    "examples:install" = {
      description = "Install examples workspace dependencies";
      exec = pnpmRun "examples:install";
      after = [ "setup:strict" ];
    };

    "examples:build:src" = {
      description = "Build examples source bundles";
      exec = pnpmRun "examples:build:src";
      after = [ "examples:install" ];
    };

    # =========================================================================
    # Release
    # =========================================================================

    "release:snapshot" = {
      description = "Publish snapshot release to npm";
      exec = pnpmRun "release:snapshot";
    };

    "release:snapshot:git-sha" = {
      description = "Publish snapshot release pinned to GIT_SHA";
      exec = pnpmRun "release:snapshot:git-sha";
      after = [ "setup:strict" ];
    };

    "release:plan" = {
      description = "Write release/release-plan.json for a stable release PR";
      exec = pnpmRun "release:plan";
      after = [ "pnpm:install" ];
    };

    "release:notes:extract" = {
      description = "Slice the current release's section from CHANGELOG.md into release/release-notes.md";
      exec = pnpmRun "release:notes:extract";
      after = [ "pnpm:install" ];
    };

    "release:stable:dryrun" = {
      description = "Dry-run stable release publishing from release/release-plan.json";
      exec = pnpmRun "release:stable:dryrun";
      after = [ "setup:strict" ];
    };

    "release:stable:publish" = {
      description = "Publish stable release from release/release-plan.json";
      exec = pnpmRun "release:stable:publish";
      after = [ "setup:strict" ];
    };

    # =========================================================================
    # Lint (dt-native)
    # =========================================================================

    "lint:check:madge" = {
      description = "Check circular dependencies with madge";
      exec = pnpmRun "lint:check:madge";
      after = [ "pnpm:install" ];
    };

    "lint:check:md-imports" = {
      description = "Check markdown files for ESM imports";
      exec = pnpmRun "lint:check:md-imports";
    };

    "lint:full" = {
      description = "Run full lint checks (lint:check + madge + markdown import guard)";
      exec = pnpmRun "lint:full";
      after = [ "pnpm:install" ];
    };

    "lint:full:with-megarepo-check" = {
      description = "Run full lint checks plus megarepo consistency";
      exec = pnpmRun "lint:full:with-megarepo-check";
      after = [ "pnpm:install" ];
    };

    "lint:full:fix" = {
      description = "Fix lint issues, then run full lint checks";
      exec = pnpmRun "lint:full:fix";
      after = [ "pnpm:install" ];
    };
  };
}
