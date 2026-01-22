{
  pkgs,
  lib,
  inputs,
  ...
}:
let
  system = pkgs.stdenv.hostPlatform.system;
  playwrightDriver = inputs.playwright-web-flake.packages.${system}.playwright-driver;
  cliPackages = inputs.effect-utils.lib.mkCliPackages {
    inherit pkgs;
    pkgsUnstable = pkgs;
  };
  taskModules = inputs.effect-utils.devenvModules.tasks;
  
  # Local task modules
  localTaskModules = {
    lint = import ./nix/devenv-modules/tasks/lint.nix;
    ts = ./nix/devenv-modules/tasks/ts.nix;
  };

  # Explicit glob patterns for execIfModified (avoids node_modules traversal)
  execIfModifiedPatterns = [
    # packages
    "packages/@livestore/*/src/**/*.ts"
    "packages/@local/*/src/**/*.ts"
    # examples
    "examples/*/src/**/*.ts"
    "examples/*/src/**/*.tsx"
    # tests
    "tests/*/src/**/*.ts"
    # scripts
    "scripts/src/**/*.ts"
    # docs
    "docs/src/**/*.ts"
    "docs/src/**/*.tsx"
  ];

  # Genie file patterns for caching
  geniePatterns = [
    "packages/@livestore/*/*.genie.ts"
    "packages/@local/*/*.genie.ts"
    "tests/*/*.genie.ts"
    "docs/*.genie.ts"
    "*.genie.ts"
    ".github/workflows/*.genie.ts"
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
    inputs.effect-utils.devenvModules.dt
    # Shared task modules from effect-utils
    taskModules.genie
    (taskModules.check { hasTests = false; })
    # Local ts module (uses tsconfig.dev.json instead of tsconfig.all.json)
    localTaskModules.ts
    (taskModules.clean { extraDirs = [ ".astro" ]; })
    # Local lint module (livestore-specific oxfmt + oxlint config)
    (localTaskModules.lint {
      inherit execIfModifiedPatterns geniePatterns;
    })
  ];

  packages = [
    pkgs.bun
    pkgs.nodejs_24
    pkgs.typescript
    pkgs.oxlint
    pkgs.oxfmt
    cliPackages.genie
    cliPackages.dotdot
    pkgs.caddy
    pkgs.jq
    pkgs.unzip
    pkgs.deno

    # Note: local dirty CLIs are wired via direnv helper in .envrc.
  ]
  ++ lib.optionals (!pkgs.stdenv.isDarwin) [
    pkgs.stdenv.cc.cc.lib
    pkgs.nix-ld
  ]
  ++ lib.optionals pkgs.stdenv.isDarwin [ pkgs.cocoapods ];

  env = {
    PLAYWRIGHT_BROWSERS_PATH = playwrightDriver.browsers;
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

    if [ -z "''${DEVENV_SKIP_SETUP:-}" ]; then
      bun run "$WORKSPACE_ROOT/scripts/standalone/setup.ts" || true
    fi
    [ -f "$WORKSPACE_ROOT/scripts/completions.sh" ] && source "$WORKSPACE_ROOT/scripts/completions.sh"

    if [ -d "$WORKSPACE_ROOT/scripts/.completions/zsh/site-functions" ]; then
      export FPATH="$WORKSPACE_ROOT/scripts/.completions/zsh/site-functions''${FPATH:+:''${FPATH}}"
      export LIVESTORE_ZSH_COMPLETIONS="$WORKSPACE_ROOT/scripts/.completions/zsh/site-functions"
    fi
  '';
}
