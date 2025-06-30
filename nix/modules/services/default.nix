let
  inherit (import ../lib.nix) multiService;
in
{
  imports = builtins.map multiService [
    ./grafana.nix
    ./tempo.nix
  ]; 
}
