{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.05-small";
    nixpkgsUnstable.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    process-compose-flake.url = "github:Platonic-Systems/process-compose-flake";
    playwright-web-flake = {
      url = "github:pietdevries94/playwright-web-flake";
      inputs.nixpkgs.follows = "nixpkgsUnstable";
    };
  };

  outputs = inputs@{ self, nixpkgs, nixpkgsUnstable, flake-utils, playwright-web-flake, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        overlay = final: prev: {
          inherit (playwright-web-flake.packages.${system}) playwright-driver;
        };
        pkgs = import nixpkgs {
          inherit system;
          overlays = [ overlay ];
        };
        pkgsUnstable = import nixpkgsUnstable {
          inherit system;
          overlays = [ overlay ];
        };
        corepack = pkgs.runCommand "corepack-enable" {} ''
          mkdir -p $out/bin
          ${pkgsUnstable.nodejs_24}/bin/corepack enable --install-directory $out/bin
        '';
      in
      {

        packages = {
          find-free-port = pkgsUnstable.callPackage ./packages/find-free-port.nix { };
          monitoring = import ./packages/grafana-lgtm.nix { inherit inputs pkgs; }; 
        };

        devShell = with pkgs; pkgs.mkShell {

          buildInputs = [
            pkgsUnstable.nodejs_24
            corepack
            pkgsUnstable.bun
            pkgsUnstable.esbuild
            watchman
            caddy
            act
            pkgsUnstable.deno
            
            self.packages.${system}.find-free-port

            # needed for Expo
            (lib.optionals stdenv.isDarwin [
              cocoapods
            ])
          ];

          PLAYWRIGHT_BROWSERS_PATH = pkgs.playwright-driver.browsers;
        };

      });
}
