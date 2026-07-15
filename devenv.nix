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

  devtoolsArtifactRepackExec = publishFlag: ''
    set -euo pipefail
    cd "$DEVENV_ROOT"

    : "''${LIVESTORE_RELEASE_VERSION:?Set LIVESTORE_RELEASE_VERSION to the LiveStore release-group version}"
    artifact_args=(--manifest "''${LIVESTORE_DEVTOOLS_MANIFEST:-release/devtools-artifact.json}")
    if [[ -n "''${LIVESTORE_DEVTOOLS_METADATA:-}" || -n "''${LIVESTORE_DEVTOOLS_TARBALL:-}" || -n "''${LIVESTORE_DEVTOOLS_CHROME_ZIP:-}" ]]; then
      echo "release:devtools-artifact repack requires LIVESTORE_DEVTOOLS_MANIFEST so release-candidate certification can bind to the selected artifact." >&2
      echo "Use release:devtools-artifact:verify for direct metadata/tarball integrity checks." >&2
      exit 1
    fi
    certification_path="''${LIVESTORE_DEVTOOLS_CERTIFICATION:-release/devtools-artifact.certification.json}"
    if [[ -f "$certification_path" ]]; then
      artifact_args+=(--certification "$certification_path")
    fi
    if [[ "''${LIVESTORE_DEVTOOLS_ALLOW_UNCERTIFIED_REPACK:-}" = "1" ]]; then
      artifact_args+=(--allow-uncertified)
    fi

    bun scripts/src/commands/devtools-artifact.ts repack \
      "''${artifact_args[@]}" \
      --version "$LIVESTORE_RELEASE_VERSION" \
      --out-dir "''${LIVESTORE_DEVTOOLS_OUT_DIR:-$(mktemp -d)}" \
      ${publishFlag}
  '';

  devtoolsArtifactCertifyLivenessExec = ''
    set -euo pipefail
    cd "$DEVENV_ROOT"

    : "''${LIVESTORE_RELEASE_VERSION:?Set LIVESTORE_RELEASE_VERSION to the LiveStore release-group version}"

    out_dir="''${LIVESTORE_DEVTOOLS_OUT_DIR:-$(mktemp -d)}"
    mkdir -p "$out_dir"
    export LIVESTORE_DEVTOOLS_OUT_DIR="$out_dir"

    export LIVESTORE_DEVTOOLS_ALLOW_UNCERTIFIED_REPACK=1
    ${devtoolsArtifactRepackExec "--dry-run"}
    unset LIVESTORE_DEVTOOLS_ALLOW_UNCERTIFIED_REPACK

    repacked_tarball="$out_dir/livestore-devtools-vite-$LIVESTORE_RELEASE_VERSION.tgz"
    if [ ! -f "$repacked_tarball" ]; then
      echo "Expected repacked DevTools tarball not found: $repacked_tarball" >&2
      exit 1
    fi

    playwright_bin="tests/integration/node_modules/.bin/playwright"
    if [ ! -x "$playwright_bin" ]; then
      echo "Expected Playwright binary not found: $playwright_bin" >&2
      echo "Run release:devtools-artifact:certify-liveness instead of the no-install variant when dependencies are not installed yet." >&2
      exit 1
    fi

    backup_dir="$(mktemp -d)"
    package_links=(
      "tests/integration/node_modules/@livestore/devtools-vite"
    )

    for index in "''${!package_links[@]}"; do
      package_link="''${package_links[$index]}"
      if [ ! -e "$package_link" ]; then
        echo "Expected installed @livestore/devtools-vite package link not found: $package_link" >&2
        exit 1
      fi
      cp -a "$package_link" "$backup_dir/devtools-vite-$index"
    done

    restore_node_modules() {
      for index in "''${!package_links[@]}"; do
        package_link="''${package_links[$index]}"
        rm -rf "$package_link"
        cp -a "$backup_dir/devtools-vite-$index" "$package_link"
      done
      rm -rf "$backup_dir"
    }
    trap restore_node_modules EXIT

    unpack_dir="$(mktemp -d)"
    tar -xzf "$repacked_tarball" -C "$unpack_dir"
    for package_link in "''${package_links[@]}"; do
      rm -rf "$package_link"
      cp -a "$unpack_dir/package" "$package_link"
    done
    rm -rf "$unpack_dir"

    for package_link in "''${package_links[@]}"; do
      package_version="$(bun -e "console.log(require('./$package_link/package.json').version)")"
      if [ "$package_version" != "$LIVESTORE_RELEASE_VERSION" ]; then
        echo "Expected $package_link to contain exact DevTools artifact version $LIVESTORE_RELEASE_VERSION, found $package_version" >&2
        exit 1
      fi
    done

    (
      cd tests/integration
      CI=true \
        FORCE_PLAYWRIGHT_VIA_CLI=1 \
        PLAYWRIGHT_SUITE=devtools \
        PLAYWRIGHT_HEADLESS="''${PLAYWRIGHT_HEADLESS:-1}" \
        LIVESTORE_DEVTOOLS_ENFORCE_LICENSE=false \
        DEVENV_TASK_PASSTHROUGH=1 \
        ./node_modules/.bin/playwright test \
          src/tests/playwright/devtools/web.play.ts \
          --reporter=line
    )

    certification_path="''${LIVESTORE_DEVTOOLS_CERTIFICATION:-release/devtools-artifact.certification.json}"
    evidence="DevTools exact-artifact liveness passed for $LIVESTORE_RELEASE_VERSION"
    if [[ -n "''${GITHUB_SERVER_URL:-}" && -n "''${GITHUB_REPOSITORY:-}" && -n "''${GITHUB_RUN_ID:-}" ]]; then
      evidence="$evidence in $GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
    fi
    bun scripts/src/commands/devtools-artifact.ts certify \
      --manifest "''${LIVESTORE_DEVTOOLS_MANIFEST:-release/devtools-artifact.json}" \
      --version "$LIVESTORE_RELEASE_VERSION" \
      --out "$certification_path" \
      --evidence "$evidence"
    if [[ -n "''${GITHUB_ENV:-}" ]]; then
      echo "LIVESTORE_DEVTOOLS_CERTIFICATION=$certification_path" >> "$GITHUB_ENV"
    fi
  '';

  devtoolsArtifactRepackTask =
    {
      description,
      publishFlag,
      withInstall ? true,
    }:
    {
      inherit description;
      exec = devtoolsArtifactRepackExec publishFlag;
    }
    // lib.optionalAttrs withInstall {
      after = [ "pnpm:install" ];
    };
in
{
  imports = [
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
    # Lint tasks via lint-oxc plus local aggregate wrappers.
    (taskModules.lint-oxc {
      lintPaths = [
        "packages"
        "tests"
        "scripts"
        "docs"
        ".github"
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
    (taskModules.pnpm { packages = pnpmPackages; })
    # PR-preview reporting: provides workflow-report:{collect-bundle,
    # render-comment-body,publish}, invoked by the generated report-pr-preview
    # CI job. Replaces the former `nix run <effect-utils>#workflow-report` flake
    # entrypoint (removed upstream when reporting moved into ci-tools).
    (taskModules.workflow-report {
      ciToolsBin = "${effectUtilsPackages.ci-tools}/bin/ci-tools";
    })
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
    ./nix/devenv-modules/tasks/local/github-rulesets.nix
  ];

  # Non-`.genie.ts` generator inputs (source-of-truth modules that the `.genie.ts`
  # files import: catalog/topology/validation helpers under genie/). These join the
  # `genie:run` warm-cache fingerprint so editing e.g. `genie/external.ts` actually
  # busts the cache and regenerates — otherwise a helper-only edit is silently
  # skipped as "up to date". The `.genie.ts` sources themselves are already tracked
  # by the module; the glob overlap with genie/**/*.genie.ts is harmless.
  effectUtils.genie.extraInputGlobs = [
    ":(glob)genie/**/*.ts"
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
      if [[ -n "''${LIVESTORE_DEVTOOLS_METADATA:-}" || -n "''${LIVESTORE_DEVTOOLS_TARBALL:-}" || -n "''${LIVESTORE_DEVTOOLS_CHROME_ZIP:-}" ]]; then
        : "''${LIVESTORE_DEVTOOLS_METADATA:?Set both LIVESTORE_DEVTOOLS_METADATA and LIVESTORE_DEVTOOLS_TARBALL, or neither to use the checked-in manifest}"
        : "''${LIVESTORE_DEVTOOLS_TARBALL:?Set both LIVESTORE_DEVTOOLS_METADATA and LIVESTORE_DEVTOOLS_TARBALL, or neither to use the checked-in manifest}"
        artifact_args=(--metadata "$LIVESTORE_DEVTOOLS_METADATA" --tarball "$LIVESTORE_DEVTOOLS_TARBALL")
        if [[ -n "''${LIVESTORE_DEVTOOLS_CHROME_ZIP:-}" ]]; then
          artifact_args+=(--chrome-zip "$LIVESTORE_DEVTOOLS_CHROME_ZIP")
        fi
      fi

      bun scripts/src/commands/devtools-artifact.ts verify "''${artifact_args[@]}"
    '';
    after = [ "pnpm:install" ];
  };

  tasks."release:devtools-artifact:repack-dryrun" = devtoolsArtifactRepackTask {
    description = "Verify and repack a public LiveStore DevTools artifact for a LiveStore release version";
    publishFlag = "--dry-run";
  };

  tasks."release:devtools-artifact:repack-dryrun:no-install" = devtoolsArtifactRepackTask {
    description = "Verify and repack a public LiveStore DevTools artifact after release setup has already run";
    publishFlag = "--dry-run";
    withInstall = false;
  };

  tasks."release:devtools-artifact:certify-liveness" = {
    description = "Repack the public DevTools artifact and run the strict Playwright liveness certification";
    exec = devtoolsArtifactCertifyLivenessExec;
    after = [ "pnpm:install" ];
  };

  tasks."release:devtools-artifact:certify-liveness:no-install" = {
    description = "Run the strict DevTools artifact liveness certification after release setup has already run";
    exec = devtoolsArtifactCertifyLivenessExec;
  };

  tasks."release:devtools-artifact:publish" = devtoolsArtifactRepackTask {
    description = "Verify, repack, and publish a public LiveStore DevTools artifact for a LiveStore release version";
    publishFlag = "--publish";
  };

  tasks."release:devtools-artifact:publish:no-install" = devtoolsArtifactRepackTask {
    description = "Verify, repack, and publish a public LiveStore DevTools artifact after release setup has already run";
    publishFlag = "--publish";
    withInstall = false;
  };

  tasks."release:changeset:check-pr" = {
    description = "Require PR-level changeset intent when public LiveStore package files change";
    exec = ''
      set -euo pipefail
      cd "$DEVENV_ROOT"

      bun scripts/src/commands/changesets.ts check-pr --base "''${CHANGESET_BASE_REF:-origin/main}"
    '';
  };

  tasks."release:changeset:check-bodies" = {
    description = "Reject malformed changesets (empty frontmatter and empty body)";
    exec = ''
      set -euo pipefail
      cd "$DEVENV_ROOT"

      bun scripts/src/commands/changesets.ts check-bodies
    '';
  };

  tasks."release:changeset:status" = {
    description = "Show pending Changesets release status";
    exec = ''
      set -euo pipefail
      cd "$DEVENV_ROOT"

      DEVENV_TASK_PASSTHROUGH=1 pnpm exec changeset status --since "''${CHANGESET_BASE_REF:-origin/main}"
    '';
    after = [ "pnpm:install" ];
  };

  tasks."release:changeset:version" = {
    description = "Prepare a Changesets release plan, regenerate manifests, and preserve prerelease intent when needed";
    exec = ''
      set -euo pipefail
      cd "$DEVENV_ROOT"

      # Changesets edits generated package manifests before Genie re-materializes
      # them from release/version.json.
      git ls-files '*package.json' | xargs chmod u+w
      DEVENV_TASK_PASSTHROUGH=1 pnpm exec changeset version
      bun scripts/src/commands/changesets.ts restore-prerelease-changesets
      bun scripts/src/commands/changesets.ts sync-version-source
      DEVENV_TASK_PASSTHROUGH=1 genie
      bun scripts/src/commands/changesets.ts sync-standalone-consumers
      DEVENV_TASK_PASSTHROUGH=1 pnpm install --lockfile-only --no-frozen-lockfile
      bun scripts/src/commands/changesets.ts assert-fixed-versions
      bun scripts/src/commands/changesets.ts write-release-plan --npm-tag "''${LIVESTORE_NPM_TAG:-latest}"
    '';
    after = [ "pnpm:install" ];
  };

  tasks."release:changeset:verify-baseline" = {
    description = "Verify the baseline changeset losslessly mirrors the handcrafted 0.4.0 changelog section";
    exec = ''
      set -euo pipefail
      cd "$DEVENV_ROOT"

      bun scripts/src/commands/changesets.ts verify-baseline-changelog
    '';
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
