{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.05";
    nixpkgsUnstable.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    playwright-web-flake = {
      url = "github:pietdevries94/playwright-web-flake";
      inputs.nixpkgs.follows = "nixpkgsUnstable";
    };

    self.submodules = true;
  };

  outputs =
    {
      self,
      nixpkgs,
      nixpkgsUnstable,
      flake-utils,
      playwright-web-flake,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
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
        corepack = pkgs.runCommand "corepack-enable" { } ''
          mkdir -p $out/bin
          ${pkgsUnstable.nodejs_24}/bin/corepack enable --install-directory $out/bin
        '';
      in
      {

        devShell =
          with pkgs;
          pkgs.mkShell {

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

        packages = {
          # Build using submodules automatically pulled by Nix
          wa-sqlite-livestore = pkgs.callPackage ./packages/wa-sqlite-livestore {
            inherit pkgsUnstable;
            waSQLiteSrc = "${self}/../wa-sqlite";
          };
        };

        # Explicit apps for wa-sqlite management
        apps = {
          build-wa-sqlite = {
            type = "app";
            program = toString (
              pkgs.writeShellScript "build-wa-sqlite" ''
                set -euo pipefail

                echo "Building wa-sqlite..."

                # Initialize submodule if needed (first time setup)
                if [ ! -f wa-sqlite/package.json ]; then
                  echo "First time setup: initializing wa-sqlite submodule..."
                  git submodule update --init --recursive
                fi

                pkg=$(nix build --no-link --print-out-paths ./nix#wa-sqlite-livestore)

                # Setup/update dist directory
                mkdir -p wa-sqlite
                rm -rf wa-sqlite/dist
                echo "Copying built package from $pkg..."
                cp -rf "$pkg/dist" wa-sqlite/dist
                chmod -R u+w wa-sqlite/dist
                echo "✓ wa-sqlite build complete"
              ''
            );
          };
        };

      }
    );
}
