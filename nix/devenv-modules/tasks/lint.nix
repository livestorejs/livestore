# Lint tasks for livestore (oxfmt + oxlint)
#
# TODO: Migrate from biome to oxlint for full consistency with effect-utils
# Currently uses oxfmt for formatting and oxlint for linting.
# The mono CLI still has biome references that should be cleaned up.
#
# Provides: lint:check, lint:check:format, lint:check:oxlint, lint:check:genie
#           lint:fix, lint:fix:format, lint:fix:oxlint
{
  execIfModifiedPatterns,
  geniePatterns,
}:
{ ... }:
let
  # Oxc config lives in packages/@local/oxc-config
  oxcConfigPath = "packages/@local/oxc-config";
  
  # Exclude patterns for oxfmt (genie-generated read-only files)
  oxfmtExcludeArgs = builtins.concatStringsSep " " [
    "'!**/node_modules/**'"
    "'!**/package.json'"
    "'!**/tsconfig.json'"
    "'!**/tsconfig.*.json'"
    "'!.github/workflows/*.yml'"
    "'!packages/@local/oxc-config/*.jsonc'"
  ];
in
{
  tasks = {
    # Lint check tasks
    "lint:check:format" = {
      description = "Check code formatting with oxfmt";
      exec = "oxfmt -c ${oxcConfigPath}/fmt.jsonc --check . ${oxfmtExcludeArgs}";
      after = [ "genie:run" ];
      execIfModified = execIfModifiedPatterns;
    };
    "lint:check:oxlint" = {
      description = "Run oxlint linter";
      exec = "oxlint -c ${oxcConfigPath}/lint.jsonc --import-plugin --deny-warnings";
      after = [ "genie:run" ];
      execIfModified = execIfModifiedPatterns;
    };
    "lint:check:genie" = {
      description = "Check generated files are up to date";
      exec = "genie --check";
      execIfModified = geniePatterns;
    };
    "lint:check" = {
      description = "Run all lint checks";
      after = [ "lint:check:format" "lint:check:oxlint" "lint:check:genie" ];
    };

    # Lint fix tasks
    "lint:fix:format" = {
      description = "Fix code formatting with oxfmt";
      exec = "oxfmt -c ${oxcConfigPath}/fmt.jsonc . ${oxfmtExcludeArgs}";
    };
    "lint:fix:oxlint" = {
      description = "Fix lint issues with oxlint";
      exec = "oxlint -c ${oxcConfigPath}/lint.jsonc --import-plugin --deny-warnings --fix";
    };
    "lint:fix" = {
      description = "Fix all lint issues";
      after = [ "lint:fix:format" "lint:fix:oxlint" ];
    };
  };
}
