{ config, lib, name, pkgs, ... }: let 
  inherit (lib) types;
  iniFormat = pkgs.formats.ini {};
  yamlFormat = pkgs.formats.yaml {};
in {
  options = {
    package = lib.mkPackageOption pkgs "grafana" {};

    protocol = lib.mkOption {
      type = types.str;
      description = "The protocol to use for connecting to Grafana (eg http, https, h2, socket)";
      default = "http";
    };

    domain = lib.mkOption {
      type = types.str;
      description = "The public facing domain name used to access Grafana from a browser.";
      default = "localhost";
    };

    http_port = lib.mkOption {
      type = types.int;
      description = "The HTTP port to use for the Grafana server.";
      default = 3000;
    };

    extraConf = lib.mkOption {
      inherit (iniFormat) type;
      description = "Extra configuration to pass to the Grafana server via the `--config` flag";
      default = {};
      example = ''
        {
          security.admin_user = "grafana";
          security.admin_password = "grafana";
        }
      '';
    };

    datasources = lib.mkOption {
      type = types.listOf yamlFormat.type;
      description = ''
        Datasources to configure for the Grafana server.

        See https://grafana.com/docs/grafana/latest/administration/provisioning/#data-sources for the schema.
      '';
      default = [];
      example = ''
        [
          {
            name = "Tempo";
            type = "tempo";
            access = "proxy";
          }
        ]
      '';
    };

    deleteDatasources = lib.mkOption {
      type = types.listOf yamlFormat.type;
      description = "Datasources to remove from the Grafana server";
      default = [];
      example = ''
        [
          { name = "Tempo"; }
        ]
      '';
    };

    declarativePlugins = lib.mkOption {
      type = types.nullOr (types.listOf types.path);
      description = "Packages containing Grafana plugins to insall";
      default = null;
      example = "with pkgs.grafanaPlugins; [ grafana-piechart-panel ]";
      # Make sure plugins are only added once otherwise building the link farm
      # fails, since the same path will be added multiple times
      apply = x: if lib.isList x then lib.unique x else x;
    };

    providers = lib.mkOption {
      type = types.listOf yamlFormat.type;
      description = ''
        Dashboard providers to configure for the Grafana server.

        See https://grafana.com/docs/grafana/latest/administration/provisioning/#dashboards for the schema.
      '';
      default = [];
      example = ''
        [
          {
            name = "Databases";
            type = "file";
            options = {
              path = ./dashboards;
              foldersFromFilesStructure = true;
            };
          }
        ]
      '';
    };
  };

  config = {
    outputs.settings.processes."${name}" = let
      grafanaConfig = lib.recursiveUpdate {
        server = { inherit (config) protocol domain http_port; };
      } config.extraConf;

      grafanaConfigIni = iniFormat.generate "defaults.ini" grafanaConfig;

      grafanaProvisioningConfig = pkgs.stdenv.mkDerivation {
        name = "grafana-provisioning";

        datasourcesYaml = yamlFormat.generate "datasources.yaml" {
          inherit (config) datasources deleteDatasources;
          apiVersion = 1;
        };

        providersYaml = yamlFormat.generate "providers.yaml" {
          inherit (config) providers;
          apiVersion = 1;
        };

        buildCommand = ''
          mkdir -p $out/{alerting,dashboards,datasources,notifiers,plugins}
          ln -s "$datasourcesYaml" "$out/datasources/datasources.yaml"
          ln -s "$providersYaml" "$out/dashboards/providers.yaml"
        '';
      };

      plugins = builtins.map (pkg: { name = pkg.pname; path = pkg; }) config.declarativePlugins;
      grafanaPlugins = pkgs.linkFarm "grafana-plugins" plugins;

      startScript = pkgs.writeShellApplication {
        name = "grafana-server-start";

        runtimeInputs = [ config.package ] ++ (lib.lists.optionals pkgs.stdenv.isDarwin [ pkgs.coreutils ]);

        text = ''
          grafana server --config ${grafanaConfigIni} \
                         --homepath ${config.package}/share/grafana \
                         cfg:paths.data="$(readlink -m ${config.dataDir})" \
                         ${lib.optionalString (config.declarativePlugins != null) "cfg:paths.plugins=${grafanaPlugins}"} \
                         cfg:paths.provisioning="${grafanaProvisioningConfig}" 
        '';
      };
    in {
      command = startScript;

      readiness_probe = {
        http_get = {
          host = config.domain;
          scheme = config.protocol;
          port = config.http_port;
          path = "/api/health";
        };
        initial_delay_seconds = 15;
        period_seconds = 10;
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
