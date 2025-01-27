{
  inputs = {
    nixpkgsUnstable.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    playwright-web-flake = {
      url = "github:pietdevries94/playwright-web-flake";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgsUnstable, flake-utils, playwright-web-flake }:
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
          # playwright-driver2 = pkgsUnstable.callPackage ./nix/playwright.nix { };
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

          # See version https://github.com/NixOS/nixpkgs/blob/nixos-unstable/pkgs/development/web/playwright/driver.nix#L33
          # PLAYWRIGHT_BROWSERS_PATH = self.packages.${system}.playwright-driver2.browsers;
          PLAYWRIGHT_BROWSERS_PATH = pkgs.playwright-driver.browsers;
        };

      });
}
