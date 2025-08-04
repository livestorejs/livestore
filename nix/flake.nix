{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.05";
    nixpkgsUnstable.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    playwright-web-flake = {
      url = "github:pietdevries94/playwright-web-flake";
      inputs.nixpkgs.follows = "nixpkgsUnstable";
    };
  };

  outputs = { self, nixpkgs, nixpkgsUnstable, flake-utils, playwright-web-flake }:
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

        devShell = with pkgs; pkgs.mkShell {

          buildInputs = [
            pkgsUnstable.nodejs_24
            corepack
            pkgsUnstable.bun
            caddy
            pkgsUnstable.deno
            jq # Needed by some scripts

            # needed for Expo
            (lib.optionals stdenv.isDarwin [
              cocoapods
            ])
          ];

          PLAYWRIGHT_BROWSERS_PATH = pkgs.playwright-driver.browsers;
        };

      });
}
