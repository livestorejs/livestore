{ inputs, pkgs, ... }:
let
  inherit (import inputs.process-compose-flake.lib { inherit pkgs; }) makeProcessCompose;
in
makeProcessCompose {
  modules = [
    (import ../modules/process-compose)
    (
      { config, ... }:
      {
        services.tempo.tempo = {
          enable = true;
        };

        services.grafana.grafana = {
          enable = true;
          http_port = 4000;
          extraConf = {
            "auth.anonymous" = {
              enabled = true;
              org_role = "Admin";
            };
          };
          datasources = with config.services.tempo.tempo; [
            {
              name = "Tempo";
              type = "tempo";
              access = "proxy";
              url = "http://${httpAddress}:${builtins.toString httpPort}";
            }
          ];
        };

        settings.processes.grafana.depends_on.tempo.condition = "process_healthy";
      }
    )
  ];
}
