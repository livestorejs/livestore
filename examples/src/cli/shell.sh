#!/usr/bin/env bash

export DEVSERVER_HOSTNAME="dev2.tail8108.ts.net"

CLI_DIR=$(realpath $(dirname "${BASH_SOURCE[0]}"))

cd ${CLI_DIR}

# Needed for Tauri (and some Node.js scripts)
export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT="http://${DEVSERVER_HOSTNAME}:4318/v1/traces"
export OTEL_EXPORTER_OTLP_METRICS_ENDPOINT="http://${DEVSERVER_HOSTNAME}:4318/v1/traces"
export TRACING_UI_ENDPOINT="http://${DEVSERVER_HOSTNAME}:30003"

bun ./src/main.ts --completions=fish > ~/.config/fish/completions/livestore.fish

export PATH="$PATH:${CLI_DIR}/bin"

# cd ${CLI_DIR} && source <(bun ./src/main.ts --completions=bash)
# cd ${CLI_DIR} && source <(bun ./src/main.ts --completions=fish)