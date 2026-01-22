# Bun install tasks for livestore (per-package)
#
# NOTE: Currently unused due to bun bugs with local file: dependencies.
# Using pnpm:install (from effect-utils taskModules.pnpm) instead.
# See: effect-utils/context/workarounds/bun-issues.md
# TODO: Switch back to bun:install once these issues are fixed:
#   - https://github.com/oven-sh/bun/issues/13223 (file: deps slow - individual symlinks)
#   - https://github.com/oven-sh/bun/issues/22846 (install hangs in monorepo)
#
# Creates individual bun:install:<name> tasks for each package.
# Each task runs `bun install` in the package directory and caches
# based on package.json and bun.lock changes.
#
# Provides: bun:install, bun:install:<name> for each package
{ packages }:
{ lib, ... }:
let
  # Convert path to task name:
  # "packages/@livestore/foo" -> "foo"
  # "packages/@local/foo" -> "foo"
  # "tests/integration" -> "tests-integration"
  # "docs" -> "docs"
  # "scripts" -> "scripts"
  toName = path:
    let
      parts = lib.splitString "/" path;
      last = lib.last parts;
    in
    if lib.hasInfix "@livestore/" path then last
    else if lib.hasInfix "@local/" path then last
    else builtins.replaceStrings ["/"] ["-"] path;

  mkInstallTask = path: {
    "bun:install:${toName path}" = {
      description = "Install dependencies for ${toName path}";
      # Use --no-cache to avoid bun install hang bug in parallel execution
      # See: https://github.com/oven-sh/bun/issues/22846
      exec = "bun install --no-cache";
      cwd = path;
      execIfModified = [ "${path}/package.json" "${path}/bun.lock" ];
      after = [ "genie:run" ];
    };
  };

in {
  tasks = lib.mkMerge (map mkInstallTask packages ++ [
    {
      "bun:install" = {
        description = "Install all bun dependencies";
        after = map (p: "bun:install:${toName p}") packages;
      };
    }
  ]);
}
