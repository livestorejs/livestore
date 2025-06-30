{ config, lib, name, pkgs, ... }: let
  inherit (lib) types;
  yamlFormat = pkgs.formats.yaml {};
in {
  options = {
    package = lib.mkPackageOption pkgs "tempo" {};

    httpAddress = lib.mkOption {
      type = types.str;
      description = "The HTTP address to use for the Tempo server.";
      default = "localhost";
    };

    httpPort = lib.mkOption {
      type = types.int;
      description = "The HTTP port to use for the Tempo server";
      default = 3200;
    };

    extraConfig = lib.mkOption {
      inherit (yamlFormat) type;
      description = ''
        Extra configuration for the Tempo server.

        See https://grafana.com/docs/tempo/latest/configuration/ for available options.
      '';
      default = {};
    };

    extraFlags = lib.mkOption {
      type = types.listOf types.str;
      description = "Extra command line flags to pass when starting the Tempo server";
      default = [];
      example = ''
        [ "-config.expand-env=true" ]
      '';
    };
  };

  config = {
    outputs.settings.processes."${name}" = let 
      tempoConfig = lib.recursiveUpdate {
        server = {
          http_listen_address = config.httpAddress;
          http_listen_port = config.httpPort;
        };
        storage = {
          trace = {
            backend = "local";
            wal = { path = "${config.dataDir}/wal"; };
            local = { path = "${config.dataDir}/blocks"; };
          };
        };
        distributor = {
          receivers = {
            jaeger = {
              protocols = {
                thrift_http = null;
                grpc = null;
                thrift_binary = null;
                thrift_compact = null;
              };
            };
            zipkin = null;
            otlp = {
              protocols = {
                http = null;
                grpc = null;
              };
            };
            opencensus = null;
          };
        };
      } config.extraConfig;

      tempoConfigYaml = yamlFormat.generate "tempo.yaml" tempoConfig;

      startScript = pkgs.writeShellApplication {
        name = "start-tempo-server";

        runtimeInputs = [ config.package ] ++ (lib.lists.optionals pkgs.stdenv.isDarwin [ pkgs.coreutils ]);

        text = ''
          tempo --config.file=${tempoConfigYaml} ${lib.escapeShellArgs config.extraFlags}
        '';
      };
    in {
      command = startScript;

      readiness_probe = {
        http_get = {
          scheme = "http";
          host = config.httpAddress;
          port = config.httpPort;
          path = "/ready";
        };
        initial_delay_seconds = 5;
        period_seconds = 5;
        timeout_seconds = 2;
        success_threshold = 1;
        failure_threshold = 5;
      };

      availability = {
        restart = "on_failure";
        max_restarts = 5;
      };
    };
  };
}
