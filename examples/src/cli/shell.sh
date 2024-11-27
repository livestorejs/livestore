#!/usr/bin/env sh

bun ./src/main.ts --completions=fish > /tmp/livestore_completions.fish && source /tmp/livestore_completions.fish
export PATH="$PATH:$(pwd)/bin"
