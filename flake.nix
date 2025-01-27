{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.11";
    nixpkgsUnstable.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    playwright-web-flake = {
      url = "github:pietdevries94/playwright-web-flake";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, nixpkgsUnstable, flake-utils, playwright-web-flake }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        overlay = final: prev: {
          inherit (playwright-web-flake.packages.${system}) playwright-driver;
        };
        pkgsUnstable = import nixpkgsUnstable {
          inherit system;
          overlays = [ overlay ];
        };
        corepack = pkgsUnstable.runCommand "corepack-enable" {} ''
          mkdir -p $out/bin
          ${pkgsUnstable.nodejs_22}/bin/corepack enable --install-directory $out/bin
        '';
      in
      {

        packages = {
          find-free-port = pkgsUnstable.callPackage ./nix/find-free-port.nix { };
        };

        devShell = with pkgsUnstable; pkgsUnstable.mkShell {

          buildInputs = [
            nodejs_23
            corepack
            bun
            esbuild
            watchman
            caddy
            
            self.packages.${system}.find-free-port

            # needed for Expo
            (lib.optionals stdenv.isDarwin [
              # cocoapods
            ])
          ];

          PLAYWRIGHT_BROWSERS_PATH = pkgs.playwright-driver.browsers;
        };

      });
}
