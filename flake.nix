{
  inputs = {
    nixpkgsUnstable.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    playwright.url = "github:pietdevries94/playwright-web-flake";
  };

  outputs = { self, nixpkgsUnstable, flake-utils, playwright }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        overlay = final: prev: {
          inherit (playwright.packages.${system}) playwright-driver;
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
            nodejs_22
            corepack
            bun
            watchman
            caddy
            
            self.packages.${system}.find-free-port

            # needed for Expo
            (lib.optionals stdenv.isDarwin [
              cocoapods
            ])
          ];

          # See version https://github.com/NixOS/nixpkgs/blob/nixos-unstable/pkgs/development/web/playwright/driver.nix#L33
          PLAYWRIGHT_BROWSERS_PATH = pkgs.playwright-driver.browsers;
        };

      });
}
