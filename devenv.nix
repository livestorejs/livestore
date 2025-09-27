{ pkgs, lib, inputs, ... }:
let
  # Playwright browsers path from the web flake (keeps CI/local in sync)
  playwrightDriver = inputs.playwright-web-flake.packages.${pkgs.system}.playwright-driver;
in
{
  # JavaScript toolchain with Corepack (pnpm/yarn) enabled
  languages.javascript = {
    enable = true;
    # Pin Corepack to Node 24 so pnpm/yarn shims run on Node 24
    package = pkgs.nodejs_24;
    corepack.enable = true;
  };

  # Provide Node 24 alongside Corepack
  packages = [
    pkgs.nodejs_24
    pkgs.caddy
    pkgs.jq
    pkgs.bun
    pkgs.deno
  ] ++ lib.optionals pkgs.stdenv.isDarwin [ pkgs.cocoapods ];

  # Environment variables
  env.PLAYWRIGHT_BROWSERS_PATH = playwrightDriver.browsers;

  # Shell initialization (dynamic values and PATH wiring)
  enterShell = ''
    export WORKSPACE_ROOT="$PWD"

    export DEV_SSL_KEY="$WORKSPACE_ROOT/certs/key.pem"
    export DEV_SSL_CERT="$WORKSPACE_ROOT/certs/cert.pem"

    export VITE_LIVESTORE_SYNC_URL="http://localhost:8787"

    export OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:4318"
    export VITE_OTEL_EXPORTER_OTLP_ENDPOINT="$OTEL_EXPORTER_OTLP_ENDPOINT"

    export GRAFANA_ENDPOINT="http://localhost:30003"
    export VITE_GRAFANA_ENDPOINT="$GRAFANA_ENDPOINT"

    # Needed until newest corepack version ships in nixpkgs
    export COREPACK_INTEGRITY_KEYS=0

    # Add LiveStore CLIs and node bin to PATH
    export PATH="$WORKSPACE_ROOT/scripts/bin:$WORKSPACE_ROOT/node_modules/.bin:$PATH"

    # Expo / iOS quirks
    if [ "$(uname)" = "Darwin" ]; then
      export PATH="/usr/bin:/bin:$WORKSPACE_ROOT/node_modules/.bin:$PATH"
      unset DEVELOPER_DIR
    fi

    export LS_DEV=1
    export VITE_LS_DEV="$LS_DEV"

    export LIVESTORE_PLAYWRIGHT_DEV_SERVER_PORT="4444"

    export NODE_OPTIONS="--disable-warning=ExperimentalWarning"

    # Project setup + completions (best-effort)
    bun run "$WORKSPACE_ROOT/scripts/standalone/setup.ts" || true
    [ -f "$WORKSPACE_ROOT/scripts/completions.sh" ] && source "$WORKSPACE_ROOT/scripts/completions.sh"
  '';
}
