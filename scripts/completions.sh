#!/usr/bin/env bash

# TODO running `completions.sh` on initial repo setup fails because we haven't built the TS source yet which `mono` and `livestore` depend on
# resulting in an error like https://share.cleanshot.com/3ZQWLFSm

# ============================================================================
# Shell completion generation
# ============================================================================
# Generates shell completions for mono, livestore, and livestore-example-node-effect-cli CLIs.
# Supports Fish and Zsh shells.
#
# Fish: Installed globally to ~/.config/fish/completions (works automatically)
#
# Zsh: Generated in project-local $WORKSPACE_ROOT/scripts/.completions/zsh/site-functions
#      Requires one-time setup in ~/.zshrc (AFTER the direnv hook):
#
#        # Reload zsh completions when LIVESTORE_ZSH_COMPLETIONS is set by direnv
#        typeset -gA _direnv_completions_loaded
#        _direnv_completions_hook() {
#          [[ -z "$LIVESTORE_ZSH_COMPLETIONS" ]] && return
#          [[ -n "${_direnv_completions_loaded[$LIVESTORE_ZSH_COMPLETIONS]}" ]] && return
#          _direnv_completions_loaded[$LIVESTORE_ZSH_COMPLETIONS]=1
#          autoload -Uz compinit && compinit
#        }
#        autoload -Uz add-zsh-hook && add-zsh-hook precmd _direnv_completions_hook
#
# See also: https://github.com/direnv/direnv/issues/443

maybe_generate_completions() {
  local src="$1"
  local shell="$2"
  local out="$3"

  # Only regenerate when missing or stale to avoid doing work on every shell entry.
  if [ ! -f "$out" ] || [ "$src" -nt "$out" ]; then
    bun "$src" --completions="$shell" >"$out"
  fi
}

# Fish completions (global install - no project-local support in fish+direnv)
if command -v fish >/dev/null 2>&1; then
  mkdir -p "$HOME/.config/fish/completions"

  maybe_generate_completions \
    "$WORKSPACE_ROOT/scripts/src/mono.ts" \
    "fish" \
    "$HOME/.config/fish/completions/mono.fish"
  maybe_generate_completions \
    "$WORKSPACE_ROOT/examples/node-effect-cli/src/main.ts" \
    "fish" \
    "$HOME/.config/fish/completions/livestore-example-node-effect-cli.fish"
  maybe_generate_completions \
    "$WORKSPACE_ROOT/packages/@livestore/cli/src/cli.ts" \
    "fish" \
    "$HOME/.config/fish/completions/livestore.fish"
fi

# Zsh completions (project-local via FPATH, loaded in devenv.nix enterShell)
if command -v zsh >/dev/null 2>&1; then
  ZSH_COMPLETIONS_DIR="$WORKSPACE_ROOT/scripts/.completions/zsh/site-functions"
  mkdir -p "$ZSH_COMPLETIONS_DIR"

  maybe_generate_completions \
    "$WORKSPACE_ROOT/scripts/src/mono.ts" \
    "zsh" \
    "$ZSH_COMPLETIONS_DIR/_mono"
  maybe_generate_completions \
    "$WORKSPACE_ROOT/examples/node-effect-cli/src/main.ts" \
    "zsh" \
    "$ZSH_COMPLETIONS_DIR/_livestore-example-node-effect-cli"
  maybe_generate_completions \
    "$WORKSPACE_ROOT/packages/@livestore/cli/src/cli.ts" \
    "zsh" \
    "$ZSH_COMPLETIONS_DIR/_livestore"
fi
