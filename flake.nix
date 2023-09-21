{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/release-23.05";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {

        devShell = with pkgs; pkgs.mkShell {
          buildInputs = [
            nodejs_20
            (yarn.override { nodejs = nodejs_20; })
          ];
        };

      });
}
