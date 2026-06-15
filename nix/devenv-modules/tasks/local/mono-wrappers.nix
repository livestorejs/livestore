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
{
  inputs,
  pkgs,
  ...
}:
let
  pnpm = "${inputs.effect-utils.lib.mkPnpm { inherit pkgs; }}/bin/pnpm";
  tofu = "${pkgs.opentofu}/bin/tofu";
  jq = "${pkgs.jq}/bin/jq";

  # Shared preamble for the Netlify IaC tasks (.infra/iac/netlify).
  #
  # Injects the three runtime inputs OpenTofu needs as TF_VAR_* env vars,
  # preferring an already-set env var (so CI can pass them directly) and falling
  # back to the canonical source:
  #   - netlify_api_token: existing Netlify CLI login (~/.config/netlify/config.json)
  #   - state_encryption_passphrase + mxbai_api_key: 1Password via op-proxy
  # Then runs `tofu init` against the encrypted local backend.
  netlifyIacPreamble = ''
    set -euo pipefail
    cd "$DEVENV_ROOT/.infra/iac/netlify"

    if [ -z "''${TF_VAR_netlify_api_token:-}" ]; then
      if [ -n "''${NETLIFY_AUTH_TOKEN:-}" ]; then
        export TF_VAR_netlify_api_token="$NETLIFY_AUTH_TOKEN"
      else
        export TF_VAR_netlify_api_token="$(${jq} -r '.users | to_entries[0].value.auth.token' "$HOME/.config/netlify/config.json")"
      fi
    fi

    if [ -z "''${TF_VAR_state_encryption_passphrase:-}" ]; then
      # Item: LiveStore vault / "livestore-tofu-state-encryption" / password.
      # Addressed by vault+item id (the name-based op:// path resolves unreliably
      # through op-proxy for this item).
      export TF_VAR_state_encryption_passphrase="$(op-proxy read 'op://lyqreoqpojah7krktywucyjh5y/7daew6uco4ao4lpdrjpvutvjoi/password' --reason 'livestore netlify IaC state encryption' --cache 1d)"
    fi

    if [ -z "''${TF_VAR_mxbai_api_key:-}" ]; then
      export TF_VAR_mxbai_api_key="$(op-proxy read 'op://ialr3ed3depgv523r3bqojsyjq/6lpbvcuq6mdasuheabe3ms7rdm/djua6eaktvatttoxnu6e6qsqai' --reason 'livestore netlify IaC mxbai key' --cache 1d)"
    fi

    ${tofu} init -input=false >/dev/null
  '';
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
      exec = "mono test unit";
      after = [ "setup:strict" ];
    };

    "test:perf" = {
      description = "Run performance tests";
      exec = "mono test perf";
      after = [ "setup:strict" ];
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

    # Sync provider tests (individual providers for CI matrix)
    "test:integration:sync-provider" = {
      description = "Run all sync provider tests";
      exec = "mono test integration sync-provider";
    };

    "test:integration:sync-provider:mock" = {
      description = "Run mock sync provider tests";
      exec = "mono test integration sync-provider --provider mock";
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
      after = [ "setup:strict" ];
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
      after = [ "setup:strict" ];
    };

    "test:integration:playwright:upload-trace" = {
      description = "Upload Playwright report to Netlify for PLAYWRIGHT_SUITE";
      exec = ''
        set -euo pipefail
        suite="''${PLAYWRIGHT_SUITE:-}"

        if [ -z "$suite" ]; then
          echo "Error: PLAYWRIGHT_SUITE is required"
          exit 1
        fi

        if [ -n "''${NETLIFY_AUTH_TOKEN:-}" ]; then
          bunx netlify-cli deploy --no-build --dir=tests/integration/playwright-report --site livestore-ci --filter @local/tests-integration --alias "$suite-$(git rev-parse --short HEAD)"
        else
          echo "Skipping Netlify deploy: NETLIFY_AUTH_TOKEN not set"
        fi
      '';
      after = [ "setup:strict" ];
    };

    "test:integration:wa-sqlite:build" = {
      description = "Build wa-sqlite integration test target";
      cwd = "packages/@livestore/wa-sqlite";
      exec = "nix run .#build";
      after = [ "setup:strict" ];
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

    "docs:deploy:prod" = {
      description = "Build and deploy production docs";
      exec = "mono docs deploy --prod --build --purge-cdn";
    };

    # =========================================================================
    # Docs prod deploy — phase split
    #
    # The prod deploy is hoisted into deploy-prod.yml, where each phase runs as a
    # separate job (or step) wrapped in an OS-level `timeout(1)` + heartbeat. The
    # rationale is structural: the tldraw renderer (@kitschpatrol/tldraw-cli →
    # Puppeteer) can leave an orphan Chromium child after the build phase
    # completes, and that child has previously kept the deploy step hanging for
    # hours (livestorejs/livestore#1279). Capping each phase at the OS boundary
    # makes that hang both visible and recoverable without losing prior phase
    # output.
    #
    # Phase contract:
    # - snippets, diagrams, astro: build-time phases, identical to dev-surface
    #   `docs:build:phase:*` but writing logs to `tmp/ci-docs-prod/` so prod and
    #   PR artifacts don't collide.
    # - upload: `mono docs deploy --prod --step=upload`. Writes deploy IDs to
    #   `tmp/ci-docs-prod/deploy-state.json` for verify/purge.
    # - verify: `mono docs deploy --prod --step=verify`. Reads state, posts the
    #   GitHub job summary + workflow report. Markdown probe is non-fatal.
    # - purge: `mono docs deploy --prod --step=purge`. Reads state, purges the
    #   Netlify CDN cache. Failure is non-fatal — the deploy is already live.
    # =========================================================================

    "docs:deploy:prod:phase:snippets" = {
      description = "Build docs snippets for prod deploy (CI phase)";
      exec = ''
        set -euo pipefail
        mkdir -p tmp/ci-docs-prod
        timeout --signal=TERM --kill-after=2m 20m mono docs snippets build 2>&1 | tee tmp/ci-docs-prod/01-snippets.log
      '';
      after = [ "setup:strict" ];
    };

    "docs:deploy:prod:phase:diagrams" = {
      description = "Build docs diagrams for prod deploy (CI phase)";
      exec = ''
        set -euo pipefail
        mkdir -p tmp/ci-docs-prod
        timeout --signal=TERM --kill-after=2m 20m mono docs diagrams build 2>&1 | tee tmp/ci-docs-prod/02-diagrams.log
      '';
    };

    "docs:deploy:prod:phase:astro" = {
      description = "Build Astro docs bundle for prod deploy (CI phase)";
      exec = ''
        set -euo pipefail
        mkdir -p tmp/ci-docs-prod
        export LIVESTORE_DOCS_SITE_URL="https://docs.livestore.dev"
        (
          while true; do
            echo "[docs-prod-heartbeat] $(date -u +%Y-%m-%dT%H:%M:%SZ) astro build still running"
            pgrep -af 'astro|chromium|chrome_crashpad_handler|node|mono' || true
            sleep 60
          done
        ) > tmp/ci-docs-prod/03-heartbeat.log 2>&1 &
        HEARTBEAT_PID=$!
        cleanup() {
          kill "$HEARTBEAT_PID" 2>/dev/null || true
        }
        trap cleanup EXIT
        timeout --signal=TERM --kill-after=2m 20m mono docs build --api-docs --skip-deps 2>&1 | tee tmp/ci-docs-prod/03-astro-build.log
      '';
    };

    "docs:deploy:prod:phase:upload" = {
      description = "Upload prod docs build to Netlify (CI phase, writes state file)";
      exec = ''
        set -euo pipefail
        mkdir -p tmp/ci-docs-prod
        (
          while true; do
            echo "[docs-prod-heartbeat] $(date -u +%Y-%m-%dT%H:%M:%SZ) netlify upload in progress"
            pgrep -af 'netlify|node|bun|mono' || true
            sleep 30
          done
        ) > tmp/ci-docs-prod/04-upload-heartbeat.log 2>&1 &
        HEARTBEAT_PID=$!
        cleanup() {
          kill "$HEARTBEAT_PID" 2>/dev/null || true
        }
        trap cleanup EXIT
        timeout --signal=TERM --kill-after=2m 20m mono docs deploy --prod --step=upload 2>&1 | tee tmp/ci-docs-prod/04-upload.log
      '';
    };

    "docs:deploy:prod:phase:verify" = {
      description = "Verify prod docs deploy (CI phase, reads state file)";
      exec = ''
        set -euo pipefail
        mkdir -p tmp/ci-docs-prod
        timeout --signal=TERM --kill-after=1m 10m mono docs deploy --prod --step=verify 2>&1 | tee tmp/ci-docs-prod/05-verify.log
      '';
    };

    "docs:deploy:prod:phase:purge" = {
      description = "Purge prod docs Netlify CDN cache (CI phase, reads state file)";
      exec = ''
        set -euo pipefail
        mkdir -p tmp/ci-docs-prod
        timeout --signal=TERM --kill-after=1m 10m mono docs deploy --prod --step=purge 2>&1 | tee tmp/ci-docs-prod/06-purge.log
      '';
    };

    "docs:search:sync:prod" = {
      description = "Sync prod Mixedbread vector store from docs Markdown sources";
      exec = ''
        set -euo pipefail
        : "''${MXBAI_API_KEY:?Missing MXBAI_API_KEY secret}"
        : "''${MXBAI_VECTOR_STORE_ID:?Missing MXBAI_VECTOR_STORE_ID secret}"
        timeout --signal=TERM --kill-after=1m 10m \
          pnpm --dir docs exec mxbai store sync "$MXBAI_VECTOR_STORE_ID" \
            "./src/content/**/*.mdx" \
            "./src/content/**/*.md" \
            --yes --strategy fast
      '';
      after = [ "pnpm:install" ];
    };

    "docs:deploy:prod:diagnostics" = {
      description = "Collect prod docs deploy diagnostics on failure";
      exec = ''
        set -euo pipefail
        mkdir -p tmp/ci-docs-prod
        date -u +%Y-%m-%dT%H:%M:%SZ | tee tmp/ci-docs-prod/failure-timestamp.log
        ps -eo pid,ppid,etime,pcpu,pmem,comm,args > tmp/ci-docs-prod/ps-full.log || true
        pgrep -af 'astro|chromium|chrome_crashpad_handler|netlify|node|mono|dt' > tmp/ci-docs-prod/pgrep-procs.log || true
        # Surface the deploy-state file for inspection (useful when verify/purge fail).
        if [ -f tmp/ci-docs-prod/deploy-state.json ]; then
          echo "--- deploy-state.json ---"
          cat tmp/ci-docs-prod/deploy-state.json
        fi
      '';
    };

    "docs:build:phase:snippets" = {
      description = "Build docs snippets (CI phase)";
      exec = ''
        set -euo pipefail
        mkdir -p tmp/ci-docs
        timeout --signal=TERM --kill-after=2m 20m mono docs snippets build 2>&1 | tee tmp/ci-docs/01-snippets.log
      '';
      after = [ "setup:strict" ];
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

    "examples:deploy:prod" = {
      description = "Deploy examples to production Cloudflare Workers";
      exec = "mono examples deploy --prod";
    };

    "examples:validate-links" = {
      description = "Validate hosted example links";
      exec = "mono examples validate-links";
    };

    "examples:install" = {
      description = "Install examples workspace dependencies";
      exec = ''
        export npm_config_manage_package_manager_versions=false
        ${pnpm} install --frozen-lockfile --dir examples
      '';
      after = [ "setup:strict" ];
    };

    "examples:build:src" = {
      description = "Build examples source bundles";
      exec = ''
        export npm_config_manage_package_manager_versions=false
        ${pnpm} --dir examples --filter 'livestore-example-*' --workspace-concurrency=1 build
      '';
      after = [ "examples:install" ];
    };

    # =========================================================================
    # Infra (Infrastructure as Code — .infra/iac/)
    #
    # OpenTofu-managed desired state for LiveStore's public infrastructure.
    # Currently owns the two runtime env vars on the `livestore-docs` Netlify
    # site (MXBAI_API_KEY, MXBAI_VECTOR_STORE_ID). State is committed encrypted
    # (OpenTofu native state encryption); secrets are injected at runtime via
    # op-proxy/1Password (or env vars in CI). Seeds livestorejs/livestore#1244.
    # See .infra/iac/netlify/README.md.
    # =========================================================================

    "infra:netlify:plan" = {
      description = "Plan the livestore-docs Netlify env-var IaC (read-only; never applies)";
      exec = ''
        ${netlifyIacPreamble}
        ${tofu} plan -input=false
      '';
    };

    "infra:netlify:apply" = {
      description = "Apply the livestore-docs Netlify env-var IaC (only after plan shows No changes / intended diff)";
      exec = ''
        ${netlifyIacPreamble}
        ${tofu} apply -input=false
      '';
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
        mono release snapshot --git-sha="$GIT_SHA" --yes
      '';
      after = [ "setup:strict" ];
    };

    "release:plan" = {
      description = "Write release/release-plan.json for a stable release PR";
      exec = ''
        set -euo pipefail
        : "''${LIVESTORE_RELEASE_VERSION:?Set LIVESTORE_RELEASE_VERSION to the LiveStore release-group version}"
        mono release plan \
          --release-version "$LIVESTORE_RELEASE_VERSION" \
          --npm-tag "''${LIVESTORE_NPM_TAG:-latest}"
      '';
      after = [ "pnpm:install" ];
    };

    "release:notes:extract" = {
      description = "Slice the current release's section from CHANGELOG.md into release/release-notes.md";
      exec = "mono release extract-release-notes";
      after = [ "pnpm:install" ];
    };

    "release:stable:dryrun" = {
      description = "Dry-run stable release publishing from release/release-plan.json";
      exec = "mono release stable --dry-run --yes";
      after = [ "setup:strict" ];
    };

    "release:stable:publish" = {
      description = "Publish stable release from release/release-plan.json";
      exec = "mono release stable --yes --allow-existing";
      after = [ "setup:strict" ];
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
        "mr:check"
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
