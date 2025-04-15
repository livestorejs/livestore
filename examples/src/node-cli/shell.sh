#!/usr/bin/env bash

CLI_DIR=$(realpath $(dirname "${BASH_SOURCE[0]}"))

cd ${CLI_DIR}

bun ./src/main.ts --completions=fish > ~/.config/fish/completions/livestore.fish

export PATH="$PATH:${CLI_DIR}/bin"

# cd ${CLI_DIR} && source <(bun ./src/main.ts --completions=bash)
# cd ${CLI_DIR} && source <(bun ./src/main.ts --completions=fish)