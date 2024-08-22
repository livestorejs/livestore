{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/release-24.05";
    nixpkgsUnstable.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    playwright.url = "github:pietdevries94/playwright-web-flake";
  };

  outputs = { self, nixpkgs, nixpkgsUnstable, flake-utils, playwright }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        overlay = final: prev: {
          inherit (playwright.packages.${system}) playwright-driver;
        };
        pkgs = import nixpkgs {
          inherit system;
          overlays = [ overlay ];
        };
        pkgsUnstable = nixpkgsUnstable.legacyPackages.${system};
        corepack = pkgs.runCommand "corepack-enable" {} ''
          mkdir -p $out/bin
          ${pkgs.nodejs_22}/bin/corepack enable --install-directory $out/bin
        '';
      in
      {

        packages = {
          find-free-port = pkgs.callPackage ./nix/find-free-port.nix { };
        };

        devShell = with pkgs; pkgs.mkShell {
          buildInputs = [
            nodejs_22
            corepack
            pkgsUnstable.bun
            caddy
            
            self.packages.${system}.find-free-port

            # needed for Expo
            cocoapods
          ];

          # See version https://github.com/NixOS/nixpkgs/blob/nixos-unstable/pkgs/development/web/playwright/driver.nix#L33
          PLAYWRIGHT_BROWSERS_PATH = pkgs.playwright-driver.browsers;
        };

      });
}
