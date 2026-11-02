#!/usr/bin/env bash
set -euo pipefail

playwright_revision=$(jq -er '.nodes.playwright.locked.rev' devenv.lock)
browser_revision=$(jq -er '.nodes["playwright-web-flake"].locked.rev' devenv.lock)
nixpkgs_revision=$(jq -er '.nodes.nixpkgs.locked.rev' devenv.lock)
wrapper=$(nix build --no-link --print-out-paths --no-write-lock-file \
  "github:overengineeringstudio/effect-utils/$playwright_revision?dir=nix/playwright-flake#playwright" \
  --override-input nixpkgs "github:NixOS/nixpkgs/$nixpkgs_revision" \
  --override-input playwright-web-flake "github:pietdevries94/playwright-web-flake/$browser_revision")
test -x "$wrapper/bin/playwright"
printf 'MEETING_PLAYWRIGHT_WRAPPER=%s/bin/playwright\n' "$wrapper" >> "${GITHUB_ENV:?GITHUB_ENV is required}"
