#!/bin/sh

set -eu

workspace_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$workspace_root"

# Fail before touching dependency state when the portable toolchain is incomplete.
command -v node >/dev/null 2>&1 || { echo 'Minimal Setup requires Node.js 24.' >&2; exit 1; }
node_major=$(node -p "process.versions.node.split('.')[0]")
[ "$node_major" = '24' ] || { echo "Minimal Setup requires Node.js 24; found $(node --version)." >&2; exit 1; }

command -v bun >/dev/null 2>&1 || { echo 'Minimal Setup requires Bun (known-good version: 1.3.13).' >&2; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo 'Minimal Setup requires the pnpm version declared by package.json#packageManager.' >&2; exit 1; }

package_manager=$(node -p "require('./package.json').packageManager")
required_pnpm=${package_manager#pnpm@}
[ "$required_pnpm" != "$package_manager" ] || { echo "Unsupported packageManager: $package_manager" >&2; exit 1; }
actual_pnpm=$(pnpm --version)
# Exact pnpm parity keeps the committed lockfile interpretation deterministic.
[ "$actual_pnpm" = "$required_pnpm" ] || {
  echo "Minimal Setup requires pnpm $required_pnpm; found $actual_pnpm." >&2
  exit 1
}

echo "Minimal Setup: Node $(node --version), pnpm $actual_pnpm, Bun $(bun --version)"
pnpm install --frozen-lockfile
