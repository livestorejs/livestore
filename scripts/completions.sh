#!/usr/bin/env bash

# TODO running `completions.sh` on initial repo setup fails because we haven't built the TS source yet which `mono` and `livestore` depend on
# resulting in an error like https://share.cleanshot.com/3ZQWLFSm

# (1) Generate completions

# Fish
# mkdir -p $WORKSPACE_ROOT/scripts/.completions/fish
# bun $WORKSPACE_ROOT/scripts/mono.ts --completions=fish > $WORKSPACE_ROOT/scripts/.completions/fish/mono.fish
# bun $WORKSPACE_ROOT/examples/node-effect-cli/src/main.ts --completions=fish > $WORKSPACE_ROOT/scripts/.completions/fish/livestore.fish

# Until direnv + fish provides loading completions from a local directory, we need to install them globally
# See https://github.com/direnv/direnv/issues/443
# This also didn't work `path_add fish_complete_path "$WORKSPACE_ROOT/scripts/.completions/fish"`
if command -v fish >/dev/null 2>&1; then
    mkdir -p ~/.config/fish/completions
    bun $WORKSPACE_ROOT/scripts/src/mono.ts --completions=fish > ~/.config/fish/completions/mono.fish
    bun $WORKSPACE_ROOT/examples/node-effect-cli/src/main.ts --completions=fish > ~/.config/fish/completions/livestore-example-node-effect-cli.fish
    bun $WORKSPACE_ROOT/packages/@livestore/cli/src/cli.ts --completions=fish > ~/.config/fish/completions/livestore.fish
fi

# (2) Load completions

# export fish_complete_path="$WORKSPACE_ROOT/scripts/.completions/fish $fish_complete_path"
