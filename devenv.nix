{
  pkgs,
  lib,
  inputs,
  ...
}:
let
  effectUtils = inputs.effect-utils;
  taskModules = effectUtils.devenvModules.tasks;

  # Custom oxlint with NAPI bindings for JavaScript plugin support
  oxlintNpm = effectUtils.lib.mkOxlintNpm { inherit pkgs; bun = pkgs.bun; };

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
    "scripts"
  ];
in
{
  imports = [
    # Beads commit correlation for issue tracking
    (inputs.overeng-beads-public.devenvModules.beads {
      beadsPrefix = "oep";
      beadsRepoName = "overeng-beads-public";
    })
    # dt command for running devenv tasks
    effectUtils.devenvModules.dt
    # Playwright browser drivers and environment setup
    inputs.playwright.devenvModules.default
    # Shared task modules from effect-utils
    taskModules.genie
    taskModules.megarepo
    (taskModules.ts { tsconfigFile = "tsconfig.dev.json"; })
    (taskModules.check {
      hasTests = false;
      hasNixCheck = false;
    })
    (taskModules.clean {
      packages = pnpmPackages;
      extraDirs = [ ".astro" ];
    })
    # TODO: Switch fully to oxlint/oxfmt once we migrate from biome. For now `mono lint` remains primary.
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
      tsconfig = "tsconfig.dev.json";
    })
    (taskModules.pnpm { packages = pnpmPackages; })
    # Setup task (auto-runs in enterShell)
    (taskModules.setup {
      requiredTasks = [ ];
      optionalTasks = [ "megarepo:generate" "pnpm:install" "genie:run" "ts:build" ];
    })
  ];

  packages = [
    pkgs.pnpm
    pkgs.bun
    pkgs.nodejs_24
    pkgs.typescript
    oxlintNpm
    pkgs.oxfmt
    # CLIs from effect-utils (Nix-built packages)
    effectUtils.packages.${pkgs.system}.genie
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

  git-hooks.enable = true;
  git-hooks.hooks.check-quick = {
    enable = true;
    entry = "${pkgs.bash}/bin/bash -c 'dt check:quick'";
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

    export OTEL_EXPORTER_OTLP_ENDPOINT="''${OTEL_EXPORTER_OTLP_ENDPOINT:-http://localhost:4318}"
    export VITE_OTEL_EXPORTER_OTLP_ENDPOINT="''${VITE_OTEL_EXPORTER_OTLP_ENDPOINT-''${OTEL_EXPORTER_OTLP_ENDPOINT:-http://localhost:4318}}"

    export GRAFANA_ENDPOINT="''${GRAFANA_ENDPOINT:-http://localhost:30003}"
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

    export PATH="$WORKSPACE_ROOT/scripts/bin:$WORKSPACE_ROOT/node_modules/.bin:$PATH"

    if [ "$(uname)" = "Darwin" ]; then
      export PATH="/usr/bin:/bin:$WORKSPACE_ROOT/node_modules/.bin:$PATH"
      unset DEVELOPER_DIR
    fi

    export LS_DEV=1
    export VITE_LS_DEV="$LS_DEV"

    export LIVESTORE_PLAYWRIGHT_DEV_SERVER_PORT="4444"

    export NODE_OPTIONS="--disable-warning=ExperimentalWarning"

    # Setup runs via setup module (taskModules.setup) - auto-wired to enterShell

    [ -f "$WORKSPACE_ROOT/scripts/completions.sh" ] && source "$WORKSPACE_ROOT/scripts/completions.sh"

    if [ -d "$WORKSPACE_ROOT/scripts/.completions/zsh/site-functions" ]; then
      export FPATH="$WORKSPACE_ROOT/scripts/.completions/zsh/site-functions''${FPATH:+:''${FPATH}}"
      export LIVESTORE_ZSH_COMPLETIONS="$WORKSPACE_ROOT/scripts/.completions/zsh/site-functions"
    fi
  '';
}
