#!/usr/bin/env bash
set -euo pipefail

echo "=== Terragon Development Environment Setup ==="

# Install Nix using DeterminateSystems installer
echo "Installing Nix..."
if ! command -v nix &> /dev/null; then
  curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | sh -s -- install --no-confirm
  
  # Source nix daemon for current session
  if [ -e '/nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh' ]; then
    . '/nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh'
  fi
else
  echo "Nix is already installed"
fi

# Install direnv
echo "Installing direnv..."
if ! command -v direnv &> /dev/null; then
  nix-env -i direnv
else
  echo "direnv is already installed"
fi

# Setup direnv shell hook
echo "Setting up direnv shell hooks..."

# Detect shell and add appropriate hook
SHELL_NAME=$(basename "$SHELL")
case "$SHELL_NAME" in
  bash)
    SHELL_RC="$HOME/.bashrc"
    HOOK_CMD='eval "$(direnv hook bash)"'
    ;;
  zsh)
    SHELL_RC="$HOME/.zshrc"
    HOOK_CMD='eval "$(direnv hook zsh)"'
    ;;
  fish)
    SHELL_RC="$HOME/.config/fish/config.fish"
    HOOK_CMD='direnv hook fish | source'
    ;;
  *)
    echo "Warning: Unsupported shell '$SHELL_NAME'. Please manually add direnv hook."
    SHELL_RC=""
    ;;
esac

if [ -n "$SHELL_RC" ]; then
  if ! grep -q "direnv hook" "$SHELL_RC" 2>/dev/null; then
    echo "" >> "$SHELL_RC"
    echo "# Added by Terragon setup" >> "$SHELL_RC"
    echo "$HOOK_CMD" >> "$SHELL_RC"
    echo "direnv hook added to $SHELL_RC"
  else
    echo "direnv hook already exists in $SHELL_RC"
  fi
  
  # Load direnv for current session
  eval "$HOOK_CMD"
fi

# Run direnv allow if .envrc exists
if [ -f ".envrc" ]; then
  echo "Running direnv allow..."
  direnv allow
else
  echo "No .envrc file found in current directory"
fi

echo ""
echo "=== Setup Complete ==="
echo "Please restart your shell or run: source $SHELL_RC"
echo "Then navigate to your project directory and run: direnv allow"