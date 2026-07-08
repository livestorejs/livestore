{ ... }:
{
  tasks."github:rulesets:check" = {
    description = "Check live GitHub repository rulesets against generated source files";
    exec = "pnpm run github:rulesets:check";
  };
}
