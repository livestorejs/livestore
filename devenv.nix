{
  pkgs,
  lib,
  inputs,
  ...
}:
let
  # Prefer the megarepo-materialized effect-utils checkout when present so the
  # downstream shell/task CLIs match the exact generator sources imported from
  # ./repos/effect-utils during CI and local megarepo workflows.
  effectUtils =
    if builtins.pathExists ./repos/effect-utils/flake.nix then
      builtins.getFlake (toString ./repos/effect-utils)
    else
      inputs.effect-utils;
  effectUtilsPackages = effectUtils.packages.${pkgs.system};
  taskModules = effectUtils.devenvModules.tasks;
  ci = builtins.getEnv "CI" != "";

  # Custom oxlint with NAPI bindings + @overeng/oxc-config JS plugin
  oxlintNpm = effectUtils.lib.mkOxlintNpm {
    inherit pkgs;
    bun = pkgs.bun;
    src = inputs.effect-utils;
  };
  oxlintWithPlugins = effectUtils.lib.mkOxlintWithPlugins {
    inherit pkgs oxlintNpm;
  };

  # Packages managed by pnpm (shared between pnpm and clean modules)
  # NOTE: Using pnpm temporarily due to bun bugs. Plan to switch back once fixed.
  # See: effect-utils/context/workarounds/bun-issues.md
  pnpmPackages = [
    # packages/@livestore
    "packages/@livestore/adapter-cloudflare"
    "packages/@livestore/adapter-expo"
    "packages/@livestore/adapter-node"
    "packages/@livestore/adapter-web"
    "packages/@livestore/cli"
    "packages/@livestore/common"
    "packages/@livestore/common-cf"
    "packages/@livestore/devtools-expo"
    "packages/@livestore/devtools-web-common"
    "packages/@livestore/effect-playwright"
    "packages/@livestore/graphql"
    "packages/@livestore/livestore"
    "packages/@livestore/react"
    "packages/@livestore/solid"
    "packages/@livestore/sqlite-wasm"
    "packages/@livestore/svelte"
    "packages/@livestore/sync-cf"
    "packages/@livestore/sync-electric"
    "packages/@livestore/sync-s2"
    "packages/@livestore/utils"
    "packages/@livestore/utils-dev"
    "packages/@livestore/wa-sqlite"
    "packages/@livestore/webmesh"
    # packages/@local
    "packages/@local/astro-tldraw"
    "packages/@local/astro-twoslash-code"
    "packages/@local/shared"
    # tests
    "tests/integration"
    "tests/package-common"
    "tests/perf"
    "tests/perf-eventlog"
    "tests/sync-provider"
    "tests/wa-sqlite"
    # other
    "docs"
    "examples"
    "scripts"
  ];
in
{
  imports = [
    # dt command for running devenv tasks
    effectUtils.devenvModules.dt
    # OTEL observability stack with livestore-specific dashboards
    # Keep release/task automation independent from user machine-level OTEL
    # dashboard sync state. System OTEL remains useful for interactive shells,
    # but the repository task contract needs deterministic local module wiring.
    (effectUtils.devenvModules.otel { mode = "local"; })
    # Playwright browser drivers and environment setup
    inputs.playwright.devenvModules.default
    # Shared task modules from effect-utils
    taskModules.genie
    (taskModules.megarepo { syncAll = !ci; })
    (taskModules.ts { tsconfigFile = "tsconfig.dev.json"; })
    (taskModules.check {
      hasTests = false;
      hasNixCheck = false;
    })
    (taskModules.clean {
      packages = pnpmPackages;
      extraDirs = [ ".astro" ];
    })
    # Lint tasks are dt-native via lint-oxc plus local aggregate wrappers.
    (taskModules.lint-oxc {
      lintPaths = [
        "packages"
        "tests"
        "scripts"
        "docs"
        ".github"
      ];
      execIfModifiedPatterns = [
        # packages/@livestore
        "packages/@livestore/*/src/**/*.ts"
        "packages/@livestore/*/src/**/*.tsx"
        "packages/@livestore/*/src/**/*.js"
        "packages/@livestore/*/src/**/*.jsx"
        "packages/@livestore/*/*.ts"
        "packages/@livestore/*/*.js"
        "packages/@livestore/*/bin/*.ts"
        "packages/@livestore/*/examples/*/*.ts"
        "packages/@livestore/*/examples/*/*.tsx"
        "packages/@livestore/*/examples/*/src/**/*.ts"
        "packages/@livestore/*/examples/*/src/**/*.tsx"
        # packages/@local
        "packages/@local/*/src/**/*.ts"
        "packages/@local/*/src/**/*.tsx"
        "packages/@local/*/*.ts"
        "packages/@local/*/*.js"
        # tests
        "tests/**/*.ts"
        "tests/**/*.tsx"
        # scripts
        "scripts/**/*.ts"
        "scripts/**/*.js"
        # docs
        "docs/src/**/*.ts"
        "docs/src/**/*.tsx"
        # linter configs
        ".oxfmtrc.json"
        ".oxlintrc.json"
      ];
      geniePatterns = [
        ".github/workflows/*.genie.ts"
        ".oxfmtrc.json.genie.ts"
        ".oxlintrc.json.genie.ts"
        "scripts/*.genie.ts"
        "docs/*.genie.ts"
        "docs/src/**/*.genie.ts"
        "tests/**/*.genie.ts"
        "packages/@livestore/*/*.genie.ts"
        "packages/@local/*/*.genie.ts"
        "packages/@local/*/**/*.genie.ts"
      ];
      genieCoverageDirs = [
        "packages"
        "tests"
        "docs"
        "scripts"
      ];
      # TODO(oep-1n3.10): Keep wa-sqlite unmanaged by Genie for now.
      # Effect-utils now supports exclusions for the coverage check.
      genieCoverageExcludes = [ "packages/@livestore/wa-sqlite/" ];
      tsconfig = "tsconfig.dev.json";
    })
    (taskModules.ts-effect-lsp {
      tsconfigFile = "tsconfig.dev.json";
    })
    (taskModules.pnpm { packages = pnpmPackages; })
    # Setup task (auto-runs in enterShell)
    (taskModules.setup {
      requiredTasks = [ ];
      optionalTasks = [
        "pnpm:install"
        "genie:run"
        "ts:build"
      ];
    })
    # Local task: mono command wrappers for uniform dt interface
    ./nix/devenv-modules/tasks/local/mono-wrappers.nix
  ];

  packages = [
    (effectUtils.lib.mkPnpm { inherit pkgs; })
    pkgs.bun
    pkgs.nodejs_24
    pkgs.typescript
    oxlintWithPlugins
    pkgs.oxfmt
    # CLIs from effect-utils (Nix-built packages)
  ]
  ++ [ effectUtilsPackages.effect-tsgo ]
  ++ [
    effectUtilsPackages.genie
    effectUtils.packages.${pkgs.system}.megarepo
    pkgs.caddy
    pkgs.jq
    pkgs.unzip
    pkgs.deno
  ]
  ++ lib.optionals (!pkgs.stdenv.isDarwin) [
    pkgs.stdenv.cc.cc.lib
    pkgs.nix-ld
  ]
  ++ lib.optionals pkgs.stdenv.isDarwin [ pkgs.cocoapods ];

  # Note: PLAYWRIGHT_BROWSERS_PATH is set by inputs.playwright.devenvModules.default
  env = {
    PUPPETEER_SKIP_DOWNLOAD = "1";
  }
  // lib.optionalAttrs (!pkgs.stdenv.isDarwin) (
    let
      ldPath = lib.makeLibraryPath [ pkgs.stdenv.cc.cc.lib ];
    in
    {
      LD_LIBRARY_PATH = ldPath;
      NIX_LD_LIBRARY_PATH = ldPath;
    }
  );

  cachix.pull = [ "livestore" ];

  # TODO(upstream): Remove once https://github.com/cachix/devenv/pull/2423 lands.
  # devenv-tasks' glob crate traverses into node_modules for exec_if_modified patterns,
  # hashing ~243k files instead of ~800 source files (~10 min overhead per task).
  # Since oxfmt/oxlint finish in <2s, always running them is faster than broken caching.
  tasks."lint:check:format".execIfModified = lib.mkForce [ ];
  tasks."lint:check:oxlint".execIfModified = lib.mkForce [ ];

  tasks."release:devtools-artifact:verify" = {
    description = "Verify a public LiveStore DevTools artifact handoff";
    exec = ''
      set -euo pipefail
      cd "$DEVENV_ROOT"

      artifact_args=(--manifest "''${LIVESTORE_DEVTOOLS_MANIFEST:-release/devtools-artifact.json}")
      if [[ -n "''${LIVESTORE_DEVTOOLS_METADATA:-}" || -n "''${LIVESTORE_DEVTOOLS_TARBALL:-}" ]]; then
        : "''${LIVESTORE_DEVTOOLS_METADATA:?Set both LIVESTORE_DEVTOOLS_METADATA and LIVESTORE_DEVTOOLS_TARBALL, or neither to use the checked-in manifest}"
        : "''${LIVESTORE_DEVTOOLS_TARBALL:?Set both LIVESTORE_DEVTOOLS_METADATA and LIVESTORE_DEVTOOLS_TARBALL, or neither to use the checked-in manifest}"
        artifact_args=(--metadata "$LIVESTORE_DEVTOOLS_METADATA" --tarball "$LIVESTORE_DEVTOOLS_TARBALL")
      fi

      bun scripts/src/commands/devtools-artifact.ts verify "''${artifact_args[@]}"
    '';
    after = [ "pnpm:install" ];
  };

  tasks."release:devtools-artifact:repack-dryrun" = {
    description = "Verify and repack a public LiveStore DevTools artifact for a LiveStore release version";
    exec = ''
      set -euo pipefail
      cd "$DEVENV_ROOT"

      : "''${LIVESTORE_RELEASE_VERSION:?Set LIVESTORE_RELEASE_VERSION to the LiveStore release-group version}"
      artifact_args=(--manifest "''${LIVESTORE_DEVTOOLS_MANIFEST:-release/devtools-artifact.json}")
      if [[ -n "''${LIVESTORE_DEVTOOLS_METADATA:-}" || -n "''${LIVESTORE_DEVTOOLS_TARBALL:-}" ]]; then
        : "''${LIVESTORE_DEVTOOLS_METADATA:?Set both LIVESTORE_DEVTOOLS_METADATA and LIVESTORE_DEVTOOLS_TARBALL, or neither to use the checked-in manifest}"
        : "''${LIVESTORE_DEVTOOLS_TARBALL:?Set both LIVESTORE_DEVTOOLS_METADATA and LIVESTORE_DEVTOOLS_TARBALL, or neither to use the checked-in manifest}"
        artifact_args=(--metadata "$LIVESTORE_DEVTOOLS_METADATA" --tarball "$LIVESTORE_DEVTOOLS_TARBALL")
      fi

      bun scripts/src/commands/devtools-artifact.ts repack \
        "''${artifact_args[@]}" \
        --version "$LIVESTORE_RELEASE_VERSION" \
        --dry-run
    '';
    after = [ "pnpm:install" ];
  };

  tasks."release:devtools-artifact:publish" = {
    description = "Verify, repack, and publish a public LiveStore DevTools artifact for a LiveStore release version";
    exec = ''
      set -euo pipefail
      cd "$DEVENV_ROOT"

      : "''${LIVESTORE_RELEASE_VERSION:?Set LIVESTORE_RELEASE_VERSION to the LiveStore release-group version}"
      artifact_args=(--manifest "''${LIVESTORE_DEVTOOLS_MANIFEST:-release/devtools-artifact.json}")
      if [[ -n "''${LIVESTORE_DEVTOOLS_METADATA:-}" || -n "''${LIVESTORE_DEVTOOLS_TARBALL:-}" ]]; then
        : "''${LIVESTORE_DEVTOOLS_METADATA:?Set both LIVESTORE_DEVTOOLS_METADATA and LIVESTORE_DEVTOOLS_TARBALL, or neither to use the checked-in manifest}"
        : "''${LIVESTORE_DEVTOOLS_TARBALL:?Set both LIVESTORE_DEVTOOLS_METADATA and LIVESTORE_DEVTOOLS_TARBALL, or neither to use the checked-in manifest}"
        artifact_args=(--metadata "$LIVESTORE_DEVTOOLS_METADATA" --tarball "$LIVESTORE_DEVTOOLS_TARBALL")
      fi

      bun scripts/src/commands/devtools-artifact.ts repack \
        "''${artifact_args[@]}" \
        --version "$LIVESTORE_RELEASE_VERSION" \
        --publish
    '';
    after = [ "pnpm:install" ];
  };

  # NOTE: check:quick is provided by effect-utils taskModules.check.

  git-hooks.enable = true;
  git-hooks.hooks.check-quick = {
    enable = true;
    # Can't use `dt` here — git hooks run outside the devenv shell where `dt` isn't on $PATH
    entry = "devenv tasks run check:quick --mode before";
    stages = [ "pre-commit" ];
    always_run = true;
    pass_filenames = false;
  };

  enterShell = ''
    sp="$(git rev-parse --show-superproject-working-tree 2>/dev/null)";
    export WORKSPACE_ROOT="$PWD"
    export MONOREPO_ROOT="''${MONOREPO_ROOT:-''${sp:-$WORKSPACE_ROOT}}"

    export DEV_SSL_KEY="$WORKSPACE_ROOT/certs/key.pem"
    export DEV_SSL_CERT="$WORKSPACE_ROOT/certs/cert.pem"

    # OTEL_EXPORTER_OTLP_ENDPOINT is set by the otel module's env; fall back for non-otel setups
    export OTEL_EXPORTER_OTLP_ENDPOINT="''${OTEL_EXPORTER_OTLP_ENDPOINT:-http://localhost:4318}"
    export VITE_OTEL_EXPORTER_OTLP_ENDPOINT="''${VITE_OTEL_EXPORTER_OTLP_ENDPOINT-''${OTEL_EXPORTER_OTLP_ENDPOINT}}"

    # OTEL_GRAFANA_URL may not be set in system mode; default to system Grafana port
    export OTEL_GRAFANA_URL="''${OTEL_GRAFANA_URL:-http://localhost:30003}"
    export GRAFANA_ENDPOINT="''${GRAFANA_ENDPOINT:-''${OTEL_GRAFANA_URL}}"
    export VITE_GRAFANA_ENDPOINT="''${VITE_GRAFANA_ENDPOINT:-''${GRAFANA_ENDPOINT}}"

    if [ -z "''${PUPPETEER_EXECUTABLE_PATH:-}" ]; then
      for candidate in \
        "$PLAYWRIGHT_BROWSERS_PATH"/chromium-*/chrome-linux64/chrome \
        "$PLAYWRIGHT_BROWSERS_PATH"/chromium-*/chrome-linux/chrome \
        "$PLAYWRIGHT_BROWSERS_PATH"/chromium-*/chrome-mac-arm64/Google\ Chrome\ for\ Testing.app/Contents/MacOS/Google\ Chrome\ for\ Testing \
        "$PLAYWRIGHT_BROWSERS_PATH"/chromium-*/chrome-mac/Google\ Chrome\ for\ Testing.app/Contents/MacOS/Google\ Chrome\ for\ Testing \
        "$PLAYWRIGHT_BROWSERS_PATH"/chromium-*/chrome-win/chrome.exe
      do
        if [ -x "$candidate" ]; then
          export PUPPETEER_EXECUTABLE_PATH="$candidate"
          break
        fi
      done

      if [ -z "''${PUPPETEER_EXECUTABLE_PATH:-}" ]; then
        echo "[devenv] WARNING: Could not find Chrome binary in PLAYWRIGHT_BROWSERS_PATH=$PLAYWRIGHT_BROWSERS_PATH" >&2
        echo "[devenv] Checked patterns: chromium-*/chrome-{linux64,linux,mac-arm64,mac,win}/*" >&2
      fi
    fi
    export PUPPETEER_SKIP_DOWNLOAD="''${PUPPETEER_SKIP_DOWNLOAD:-1}"

    # Add effect-utils scripts to PATH (utility helpers beyond packaged CLIs).
    if [ -d "$MONOREPO_ROOT/effect-utils/scripts/bin" ]; then
      export PATH="$MONOREPO_ROOT/effect-utils/scripts/bin:$PATH"
    fi

    # In the megarepo pattern there's no root node_modules - use scripts workspace's bin instead
    export PATH="$WORKSPACE_ROOT/scripts/bin:$WORKSPACE_ROOT/scripts/node_modules/.bin:$PATH"

    if [ "$(uname)" = "Darwin" ]; then
      export PATH="/usr/bin:/bin:$PATH"
      unset DEVELOPER_DIR
    fi

    export LS_DEV=1
    export VITE_LS_DEV="$LS_DEV"

    export LIVESTORE_PLAYWRIGHT_DEV_SERVER_PORT="4444"

    export NODE_OPTIONS="--disable-warning=ExperimentalWarning"

    # Setup runs via setup module (taskModules.setup) - auto-wired to enterShell

    if [ "''${CI:-}" != "true" ] && [ "''${LIVESTORE_SKIP_COMPLETIONS:-}" != "1" ]; then
      [ -f "$WORKSPACE_ROOT/scripts/completions.sh" ] && source "$WORKSPACE_ROOT/scripts/completions.sh"
    fi

    if [ -d "$WORKSPACE_ROOT/scripts/.completions/zsh/site-functions" ]; then
      export FPATH="$WORKSPACE_ROOT/scripts/.completions/zsh/site-functions''${FPATH:+:''${FPATH}}"
      export LIVESTORE_ZSH_COMPLETIONS="$WORKSPACE_ROOT/scripts/.completions/zsh/site-functions"
    fi
  '';
}
