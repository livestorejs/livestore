# Bun install tasks for livestore (per-package)
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
      exec = "bun install";
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
