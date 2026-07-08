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

  # Packages managed by pnpm (shared between pnpm and clean modules)
  pnpmPackages = [
    # packages/@livestore
    "packages/@livestore/adapter-cloudflare"
    "packages/@livestore/adapter-web"
    "packages/@livestore/common"
    "packages/@livestore/common-cf"
    "packages/@livestore/effect-playwright"
    "packages/@livestore/livestore"
    "packages/@livestore/react"
    "packages/@livestore/sqlite-wasm"
    "packages/@livestore/sync-cf"
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
    "tests/perf"
    "tests/perf-eventlog"
    "tests/wa-sqlite"
    # other
    "docs"
    "examples"
    "scripts"
  ];

  pnpmRun = task: "pnpm run ${lib.escapeShellArg task}";
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
    # Lint tasks are local so this repo can run without generated-file checks.
    (taskModules.ts-effect-lsp {
      tsconfigFile = "tsconfig.dev.json";
      after = [ "pnpm:install" ];
    })
    (taskModules.pnpm { packages = pnpmPackages; })
    # Setup task (auto-runs in enterShell)
    (taskModules.setup {
      requiredTasks = [ ];
      optionalTasks = [
        "pnpm:install"
        "ts:build"
      ];
    })
    # Local task: mono command wrappers for uniform dt interface
    ./nix/devenv-modules/tasks/local/mono-wrappers.nix
    ./nix/devenv-modules/tasks/local/github-rulesets.nix
  ];

  # Keep Nix-provided `tsc` aligned with the workspace TypeScript catalog override so
  # devenv tasks validate against the same compiler as package-local tooling. Remove
  # this once the inherited nixpkgs `pkgs.typescript` provides TypeScript 6.0.3 or newer.
  overlays = [
    (_final: prev: {
      typescript = prev.typescript.overrideAttrs (
        _finalAttrs: _oldAttrs:
        let
          typescriptSrc = prev.fetchFromGitHub {
            owner = "microsoft";
            repo = "TypeScript";
            rev = "v6.0.3";
            hash = "sha256-RvM+fGO94ItdQxgXUcCdkpX039pytnMri100wGjNhhc=";
          };
        in
        {
          version = "6.0.3";
          src = typescriptSrc;
          npmDeps = prev.fetchNpmDeps {
            name = "typescript-6.0.3-npm-deps";
            src = typescriptSrc;
            hash = "sha256-nnBXImViLpuPPNYwBxe3T+hpoiuA/7qpIMVcXJmjklg=";
          };
          npmDepsHash = "sha256-nnBXImViLpuPPNYwBxe3T+hpoiuA/7qpIMVcXJmjklg=";
        }
      );
    })
  ];

  packages = [
    (effectUtils.lib.mkPnpm { inherit pkgs; })
    pkgs.nodejs_24
    pkgs.typescript
    # CLIs from effect-utils (Nix-built packages)
  ]
  ++ [ effectUtilsPackages.effect-tsgo ]
  ++ [
    effectUtils.packages.${pkgs.system}.megarepo
    pkgs.jq
    pkgs.unzip
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

  tasks."lint:check:format" = {
    description = "Check code formatting with oxfmt";
    exec = pnpmRun "lint:check:format";
    # TODO(upstream): Restore execIfModified once https://github.com/cachix/devenv/pull/2423 lands.
    # devenv-tasks currently traverses into node_modules while hashing glob inputs.
    execIfModified = [ ];
  };

  tasks."lint:check:oxlint" = {
    description = "Run oxlint linter";
    exec = pnpmRun "lint:check:oxlint";
    # TODO(upstream): Restore execIfModified once https://github.com/cachix/devenv/pull/2423 lands.
    # devenv-tasks currently traverses into node_modules while hashing glob inputs.
    execIfModified = [ ];
    after = [ "pnpm:install" ];
  };

  tasks."lint:check:lockfile" = {
    description = "Verify pnpm-lock.yaml matches package.json specifiers";
    after = [ "pnpm:install" ];
    exec = pnpmRun "lint:check:lockfile";
  };

  tasks."lint:check" = {
    description = "Run all lint checks";
    exec = pnpmRun "lint:check";
    after = [ "pnpm:install" ];
  };

  tasks."lint:fix:format" = {
    description = "Fix code formatting with oxfmt";
    exec = pnpmRun "lint:fix:format";
  };

  tasks."lint:fix:oxlint" = {
    description = "Fix lint issues with oxlint";
    exec = pnpmRun "lint:fix:oxlint";
  };

  tasks."lint:fix" = {
    description = "Fix all lint issues";
    exec = pnpmRun "lint:fix";
  };

  tasks."pnpm:update".after = lib.mkForce [ ];

  tasks."ts:check".exec = lib.mkForce (pnpmRun "ts:check");
  tasks."ts:check".after = lib.mkForce [ "pnpm:install" ];
  tasks."ts:check:strict".exec = lib.mkForce (pnpmRun "ts:check:strict");
  tasks."ts:check:strict".after = lib.mkForce [ "pnpm:install" ];
  tasks."ts:build".exec = lib.mkForce (pnpmRun "ts:build");
  tasks."ts:build".after = lib.mkForce [ "pnpm:install" ];
  tasks."ts:build-watch".exec = lib.mkForce (pnpmRun "ts:build-watch");
  tasks."ts:build-watch".after = lib.mkForce [ "pnpm:install" ];
  tasks."ts:clean".exec = lib.mkForce (pnpmRun "ts:clean");
  tasks."ts:emit".exec = lib.mkForce (pnpmRun "ts:emit");
  tasks."ts:emit".after = lib.mkForce [ "pnpm:install" ];
  tasks."ts:effect-lsp".after = lib.mkForce [ "pnpm:install" ];

  tasks."release:devtools-artifact:verify" = {
    description = "Verify a public LiveStore DevTools artifact handoff";
    exec = pnpmRun "release:devtools-artifact:verify";
    after = [ "pnpm:install" ];
  };

  tasks."release:devtools-artifact:repack-dryrun" = {
    description = "Verify and repack a public LiveStore DevTools artifact for a LiveStore release version";
    exec = pnpmRun "release:devtools-artifact:repack-dryrun";
    after = [ "pnpm:install" ];
  };

  tasks."release:devtools-artifact:repack-dryrun:no-install" = {
    description = "Verify and repack a public LiveStore DevTools artifact after release setup has already run";
    exec = pnpmRun "release:devtools-artifact:repack-dryrun:no-install";
  };

  tasks."release:devtools-artifact:certify-liveness" = {
    description = "Repack the public DevTools artifact and run the strict Playwright liveness certification";
    exec = pnpmRun "release:devtools-artifact:certify-liveness";
    after = [ "pnpm:install" ];
  };

  tasks."release:devtools-artifact:certify-liveness:no-install" = {
    description = "Run the strict DevTools artifact liveness certification after release setup has already run";
    exec = pnpmRun "release:devtools-artifact:certify-liveness:no-install";
  };

  tasks."release:devtools-artifact:publish" = {
    description = "Verify, repack, and publish a public LiveStore DevTools artifact for a LiveStore release version";
    exec = pnpmRun "release:devtools-artifact:publish";
    after = [ "pnpm:install" ];
  };

  tasks."release:devtools-artifact:publish:no-install" = {
    description = "Verify, repack, and publish a public LiveStore DevTools artifact after release setup has already run";
    exec = pnpmRun "release:devtools-artifact:publish:no-install";
  };

  tasks."release:changeset:check-pr" = {
    description = "Require PR-level changeset intent when public LiveStore package files change";
    exec = pnpmRun "release:changeset:check-pr";
  };

  tasks."release:changeset:check-bodies" = {
    description = "Reject malformed changesets (empty frontmatter and empty body)";
    exec = pnpmRun "release:changeset:check-bodies";
  };

  tasks."release:changeset:status" = {
    description = "Show pending Changesets release status";
    exec = pnpmRun "release:changeset:status";
    after = [ "pnpm:install" ];
  };

  tasks."release:changeset:version" = {
    description = "Prepare a Changesets release plan, regenerate manifests, and preserve prerelease intent when needed";
    exec = pnpmRun "release:changeset:version";
    after = [ "pnpm:install" ];
  };

  tasks."release:changeset:verify-baseline" = {
    description = "Verify the baseline changeset losslessly mirrors the handcrafted 0.4.0 changelog section";
    exec = pnpmRun "release:changeset:verify-baseline";
  };

  # NOTE: check:quick is provided by effect-utils taskModules.check.

  git-hooks.enable = false;
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
      # Prepend /usr/bin so Apple's xcrun/xcodebuild/xcode-select win for
      # Expo/iOS native builds — the Nix `xcbuild` shim's xcrun is incomplete
      # and breaks pod install / Expo prebuild. Do NOT prepend /bin: that
      # would put Bash 3.2 ahead of the Nix bash, and devenv task bodies
      # (e.g. effect-utils' run_pnpm_install) trip on empty array expansion
      # under `set -u` in Bash 3.2. /usr/bin/bash doesn't exist on macOS,
      # so prepending only /usr/bin keeps Nix bash in front.
      export PATH="/usr/bin:$PATH"
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
