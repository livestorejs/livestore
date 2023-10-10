{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/release-23.05";
    nixpkgsUnstable.url = "github:NixOS/nixpkgs/release-23.05";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, nixpkgsUnstable, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        pkgsUnstable = nixpkgsUnstable.legacyPackages.${system};
        corepack = pkgs.runCommand "corepack-enable" {} ''
          mkdir -p $out/bin
          ${pkgs.nodejs_20}/bin/corepack enable --install-directory $out/bin
        '';
      in
      {

        devShell = with pkgs; pkgs.mkShell {
          buildInputs = [
            nodejs_20
            corepack
            pkgsUnstable.bun
          ];
        };

      });
}
