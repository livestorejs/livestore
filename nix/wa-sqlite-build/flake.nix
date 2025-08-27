{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.05";
    nixpkgsUnstable.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, nixpkgsUnstable, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        pkgsUnstable = import nixpkgsUnstable { inherit system; };

        # https://www.sqlite.org/chronology.html
        sqliteVersion = "3.50.1";
        
        # SQLite source from exact same commit as original
        sqliteSrc = pkgs.fetchFromGitHub {
          owner = "sqlite";
          repo = "sqlite";
          rev = "979a07af38c8fb1d344253f59736cbfa91bd0a66";
          sha256 = "sha256-pFp1JMHYcb1YN/mG6+Ru2QETRtqzh/EheKVkjvCpnLo=";
        };

        buildScript = pkgs.writeShellScriptBin "build-wa-sqlite" ''
          set -euo pipefail
          export PATH="${pkgsUnstable.emscripten}/bin:${pkgs.brotli}/bin:$PATH"
          export SQLITE_SRC="${sqliteSrc}"
          export SQLITE_VERSION="${sqliteVersion}"
          exec "${./.}/build-script.sh"
        '';
      in
      {
        # nix run ./nix/wa-sqlite-build#default (from repo root)
        apps.default = {
          type = "app";
          program = toString (
            pkgs.writeShellScript "wa-sqlite-builder" ''
              set -euo pipefail
              
              REPO_ROOT=$(git rev-parse --show-toplevel)
              
              echo "Building wa-sqlite with session support and FTS5 variant..."
              
              # Run the build script and capture the dist directory path
              DIST_PATH=$(${buildScript}/bin/build-wa-sqlite)
              
              # Copy built dist back to repo
              rm -rf "$REPO_ROOT/packages/@livestore/wa-sqlite/dist"
              cp -r "$DIST_PATH" "$REPO_ROOT/packages/@livestore/wa-sqlite/"
              
              # Cleanup temp directory
              rm -rf "$(dirname "$DIST_PATH")"
              
              echo "✓ Build complete - dist directory regenerated with session support and FTS5 variant"
            ''
          );
        };
      }
    );
}