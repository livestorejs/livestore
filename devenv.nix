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

    playwright_bin="scripts/bin/playwright"
    if [ ! -x "$playwright_bin" ]; then
      echo "Expected Playwright binary not found: $playwright_bin" >&2
      echo "Run release:devtools-artifact:certify-liveness instead of the no-install variant when dependencies are not installed yet." >&2
      exit 1
    fi

    # The installed @livestore/devtools-vite is a pnpm symlink into the global
    # virtual store (GVS). When the default Node loader (and Vite) realpaths it,
    # its runtime deps (@livestore/adapter-web, @livestore/utils) resolve through
    # the GVS link dir's own node_modules — i.e. the proper published-shaped
    # *dist* of the pinned version — exactly as the passing ci.yml symlink
    # install does.
    #
    # The previous approach replaced the symlink with a *real directory* (cp -a
    # of the unpacked tarball) at the logical location. A real dir there is no
    # longer realpathed into the GVS, so dep resolution walks up
    # tests/integration/node_modules and binds @livestore/* to raw workspace TS
    # source instead of the GVS dist — a *severed* closure that differs from what
    # ci.yml exercises and silently breaks the served DevTools panel boot.
    #
    # Principled fix: keep the symlink semantics. Build a writable copy of the
    # GVS link dir that PRESERVES its node_modules sibling closure (relative
    # symlinks rewritten to absolute targets so they survive the copy), overlay
    # only the repacked dist + version-stamped package.json onto the copy's
    # devtools-vite, then point the installed symlink at this copy. The plugin
    # then runs the REPACKED dist while resolving its deps through an INTACT
    # closure (GVS dist), matching the passing install.
    package_link="tests/integration/node_modules/@livestore/devtools-vite"
    if [ ! -L "$package_link" ]; then
      echo "Expected installed @livestore/devtools-vite to be a pnpm symlink: $package_link" >&2
      exit 1
    fi

    gvs_pkg_dir="$(realpath "$package_link")"
    # gvs_pkg_dir = .../<integrity>/node_modules/@livestore/devtools-vite
    # gvs_integrity_dir = .../<integrity>/ (holds node_modules with the closure)
    gvs_integrity_dir="$(dirname "$(dirname "$(dirname "$gvs_pkg_dir")")")"
    orig_link_target="$(readlink "$package_link")"

    closure_dir="$(mktemp -d)"
    overlay_dir="$(mktemp -d)"

    restore_node_modules() {
      rm -rf "$package_link"
      ln -s "$orig_link_target" "$package_link"
      rm -rf "$closure_dir" "$overlay_dir"
    }
    trap restore_node_modules EXIT

    # Copy the GVS integrity dir (its node_modules holds the dependency closure)
    # preserving its symlinks.
    cp -a "$gvs_integrity_dir/." "$closure_dir/"

    # Rewrite copied node_modules symlinks (relative -> absolute, resolved from
    # the original GVS dir) so the closure still points at the real store.
    copied_nm="$closure_dir/node_modules"
    orig_nm="$gvs_integrity_dir/node_modules"
    while IFS= read -r link; do
      rel="''${link#$copied_nm/}"
      abs="$(realpath "$orig_nm/$rel" 2>/dev/null || true)"
      if [ -n "$abs" ]; then
        rm "$link"
        ln -s "$abs" "$link"
      fi
    done < <(find "$copied_nm" -maxdepth 3 -type l)

    # Overlay the repacked dist + version-stamped package.json onto the copy.
    tar -xzf "$repacked_tarball" -C "$overlay_dir"
    copy_pkg="$copied_nm/@livestore/devtools-vite"
    rm -rf "$copy_pkg/dist" "$copy_pkg/package.json"
    cp -a "$overlay_dir/package/dist" "$copy_pkg/dist"
    cp -a "$overlay_dir/package/package.json" "$copy_pkg/package.json"

    package_version="$(bun -e "console.log(require('$copy_pkg/package.json').version)")"
    if [ "$package_version" != "$LIVESTORE_RELEASE_VERSION" ]; then
      echo "Expected repacked DevTools to contain exact artifact version $LIVESTORE_RELEASE_VERSION, found $package_version" >&2
      exit 1
    fi

    # Point the installed symlink at the intact-closure copy.
    rm -rf "$package_link"
    ln -s "$copy_pkg" "$package_link"

    # Verify the closure is genuinely intact (deps resolve to GVS dist, not
    # severed). This guards against a future GVS layout change re-severing it.
    bun -e '
      const { createRequire } = require("node:module");
      const fs = require("node:fs");
      const path = require("node:path");
      // Resolve from the realpath, mirroring the default Node loader / Vite,
      // which realpath a module before resolving its deps.
      const pkg = fs.realpathSync("'"$package_link"'");
      const req = createRequire(path.join(pkg, "package.json"));
      for (const dep of ["@livestore/adapter-web", "@livestore/utils", "vite"]) {
        const r = req.resolve(dep);
        if (!r.includes("/links/")) {
          console.error(`Severed closure: ''${dep} resolved to ''${r} (expected GVS dist)`);
          process.exit(1);
        }
      }
      console.log("DevTools plugin closure verified intact (deps resolve to GVS dist)");
    '

    # Route through run-tests.ts's devtools command so the vite dev server is
    # started (the raw `playwright test` invocation never started it, causing
    # ERR_CONNECTION_REFUSED). `--web-only` scopes the run to web.play.ts so the
    # browser-extension test's chrome-setup dependency doesn't apply. The
    # devtools command sets FORCE_PLAYWRIGHT_VIA_CLI/PLAYWRIGHT_SUITE/
    # PLAYWRIGHT_HEADLESS itself; LIVESTORE_DEVTOOLS_ENFORCE_LICENSE and
    # DT_PASSTHROUGH are inherited from this ambient env (Effect's Command
    # merges env with process.env).
    #
    # Disable in-browser OTEL export (matches ci.yml's "Disable in Vite"): now
    # that the page actually loads, it would otherwise POST traces to the
    # devenv-defaulted VITE_OTEL_EXPORTER_OTLP_ENDPOINT (http://localhost:4318),
    # which in the validate-release-plan job has no collector and surfaces a
    # console error that effect-playwright turns into a SiteError test failure.
    (
      cd tests/integration
      CI=true \
        LIVESTORE_DEVTOOLS_ENFORCE_LICENSE=false \
        VITE_OTEL_EXPORTER_OTLP_ENDPOINT= \
        PLAYWRIGHT_HEADLESS="''${PLAYWRIGHT_HEADLESS:-1}" \
        DT_PASSTHROUGH=1 \
        LIVESTORE_DEVTOOLS_DIAGNOSTICS=1 \
        bun ./scripts/run-tests.ts devtools --mode headless --web-only
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
    ./nix/devenv-modules/tasks/local/github-rulesets.nix
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
    # d2 for the astro-d2 docs diagrams. The npm terrastruct-d2-bin binary is not
    # usable under the pure-pnpm install (its postinstall is skipped), so provide
    # the matching d2 version (0.7.1) from Nix on PATH instead.
    pkgs.d2
  ]
  ++ lib.optionals (!pkgs.stdenv.isDarwin) [
    pkgs.stdenv.cc.cc.lib
    pkgs.nix-ld
  ]
  ++ lib.optionals pkgs.stdenv.isDarwin [ pkgs.cocoapods ];

  _module.args.geniePkg = effectUtilsPackages.genie;

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

      DT_PASSTHROUGH=1 pnpm exec changeset status --since "''${CHANGESET_BASE_REF:-origin/main}"
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
      DT_PASSTHROUGH=1 pnpm exec changeset version
      bun scripts/src/commands/changesets.ts restore-prerelease-changesets
      bun scripts/src/commands/changesets.ts sync-version-source
      DT_PASSTHROUGH=1 genie
      bun scripts/src/commands/changesets.ts sync-standalone-consumers
      DT_PASSTHROUGH=1 pnpm install --lockfile-only --no-frozen-lockfile
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
