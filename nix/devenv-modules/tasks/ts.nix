# TypeScript tasks for livestore
#
# Uses tsconfig.dev.json (livestore's main config) instead of tsconfig.all.json
#
# Provides: ts:check, ts:watch, ts:build, ts:clean
{ ... }:
{
  tasks = {
    "ts:check" = {
      description = "Run TypeScript type checking";
      exec = "tsc --build tsconfig.dev.json";
      after = [ "genie:run" ];
    };
    "ts:watch" = {
      description = "Run TypeScript in watch mode";
      exec = "tsc --build --watch tsconfig.dev.json";
      after = [ "genie:run" ];
    };
    "ts:build" = {
      description = "Build all packages (tsc --build)";
      exec = "tsc --build tsconfig.dev.json";
      after = [ "genie:run" ];
    };
    "ts:clean" = {
      description = "Remove TypeScript build artifacts";
      exec = "tsc --build --clean tsconfig.dev.json";
    };
  };
}
