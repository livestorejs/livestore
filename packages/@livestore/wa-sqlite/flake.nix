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
        sqliteVersion = "3.50.4";

        sqliteCommit = "8ed5e7365e6f12f427910188bbf6b254daad2ef6";
        
        # SQLite source from exact same commit as original
        sqliteSrc = pkgs.fetchFromGitHub {
          owner = "sqlite";
          repo = "sqlite";
          rev = sqliteCommit;
          sha256 = "sha256-YXzEu1/BC41mv08wm67kziRkQsSEmd/N00pY7IwF3rc=";
          name = "sqlite-src";
        };

        # Extension functions from SQLite contrib
        extensionFunctions = pkgs.fetchurl {
          url = "https://www.sqlite.org/contrib/download/extension-functions.c?get=25";
          sha256 = "sha256-mRtA/osnme3CFfcmC4kPFKgzUSydmJaqCAiRMw/+QFI=";
          name = "extension-functions.c";
        };

        waSqliteDerivation = pkgs.stdenv.mkDerivation rec {
          pname = "wa-sqlite-livestore";
          version = sqliteVersion;

          src = ./.;

          srcs = [
            src
            sqliteSrc
          ];

          sourceRoot = pname;

          # Disable the automatic update of GNU config scripts
          dontUpdateAutotoolsGnuConfigScripts = true;

          nativeBuildInputs = with pkgs; [
            which # needed for Makefile
            tcl
            gcc
            wabt
            unzip
            openssl
            zip
            gzip
            brotli
          ] ++ (with pkgsUnstable; [
            emscripten
          ]);

          unpackPhase = ''
            runHook preUnpack

            mkdir -p ${pname}
            cd ${pname}
            
            # Unpack the SQLite source to sqlite-src
            unpackFile ${sqliteSrc}

            # Copy wa-sqlite sources (self)
            cp -r ${src}/* .

            # Set the source root
            sourceRoot=${pname}

            cd ..

            runHook postUnpack
          '';

          configurePhase = ''
            runHook preConfigure

            echo "Emscripten version:"
            emcc --version

            pwd
            ls -la

            mkdir -p cache/version-${version}
            cp -r ./sqlite-src/* ./cache/version-${version}

            cp ${extensionFunctions} ./cache/extension-functions.c

            # Since we provide the source code via Nix, we don't need to download it
            # comment out all `curl` commands in `Makefile` of wa-sqlite
            chmod u+w Makefile # Ensure we have write permissions for the Makefile
            sed -i 's/curl/#curl/g' Makefile
            
            # Update the SQLITE_VERSION in the Makefile to match our version
            sed -i 's/SQLITE_VERSION = version-.*/SQLITE_VERSION = version-${version}/g' Makefile

            # Add `dist/wa-sqlite.node.mjs` to end of `Makefile` of wa-sqlite
            # Note: We use EMFLAGS_DIST to ensure memory growth is enabled (via EMFLAGS_COMMON)
            # This allows the WASM heap to grow dynamically at runtime, preventing "Cannot enlarge memory arrays" errors
            # when working with databases larger than the initial 16MB allocation
            cat >> Makefile <<'EOF'
dist/wa-sqlite.node.mjs: $(OBJ_FILES_DIST) $(JSFILES) $(EXPORTED_FUNCTIONS) $(EXPORTED_RUNTIME_METHODS)
	mkdir -p dist
	$(EMCC) $(EMFLAGS_DIST) $(EMFLAGS_INTERFACES) $(EMFLAGS_LIBRARIES) -s ENVIRONMENT=node $(OBJ_FILES_DIST) -o $@
EOF

            cat Makefile

            runHook postConfigure
          '';

          buildPhase = ''
            runHook preBuild

            # Needed for `make`
            export DESTDIR="$PWD"
            export HOME="$PWD"

            mkdir -p cache/emscripten
            export EM_CACHE="$PWD/cache/emscripten"

            # Ensure dist directory exists and has correct permissions
            mkdir -p dist
            chmod 755 dist

            # Extra build with FTS5
            make dist/wa-sqlite.mjs dist/wa-sqlite.node.mjs WASQLITE_EXTRA_DEFINES="-DSQLITE_ENABLE_BYTECODE_VTAB -DSQLITE_ENABLE_SESSION -DSQLITE_ENABLE_PREUPDATE_HOOK -DSQLITE_ENABLE_FTS5"
            mkdir -p dist-fts5
            mv dist/wa-sqlite* dist-fts5

            # Make dist files writable before cleaning
            chmod -R u+w dist/ || true

            make clean

            # Add SQLite flags to `ext/wasm/api/sqlite3-wasm.c` (bytecode, session (incl. preupdate))
            make dist/wa-sqlite.mjs dist/wa-sqlite.node.mjs WASQLITE_EXTRA_DEFINES="-DSQLITE_ENABLE_BYTECODE_VTAB -DSQLITE_ENABLE_SESSION -DSQLITE_ENABLE_PREUPDATE_HOOK"

            # Build async and jspi variants for standard build (before organizing FTS5)
            make dist/wa-sqlite-async.mjs dist/wa-sqlite-jspi.mjs WASQLITE_EXTRA_DEFINES="-DSQLITE_ENABLE_BYTECODE_VTAB -DSQLITE_ENABLE_SESSION -DSQLITE_ENABLE_PREUPDATE_HOOK"

            # Organize FTS5 variant (only move web and node variants)
            mkdir -p dist/fts5
            mv dist-fts5/wa-sqlite.mjs dist/fts5/wa-sqlite.mjs
            mv dist-fts5/wa-sqlite.wasm dist/fts5/wa-sqlite.wasm  
            mv dist-fts5/wa-sqlite.node.mjs dist/fts5/wa-sqlite.node.mjs
            mv dist-fts5/wa-sqlite.node.wasm dist/fts5/wa-sqlite.node.wasm
            rm -rf dist-fts5

            # Adjust `mayCreate` code in all .mjs dist files
            for file in dist/*.mjs dist/fts5/*.mjs; do
              sed -i '
                /mayCreate(dir, name) {/,/FS.lookupNode(dir, name);/ c\
  mayCreate(dir, name) {\
      var node\
      try {\
        node = FS.lookupNode(dir, name);
        ' "$file"
            done

            # Adjust `mayCreate` in minified dist files
            for file in dist/*.mjs dist/fts5/*.mjs; do
              sed -i 's/mayCreate(dir,name){try{var node=FS.lookupNode(dir,name)/mayCreate(dir,name){var node;try{node=FS.lookupNode(dir,name)/g' "$file"
            done

            # Generate README with build information
            {
              echo "# wa-sqlite Build Information"
              echo ""
              echo "This dist directory was built with the following configuration:"
              echo ""
              echo "## Build Environment"
              echo "- **Built on:** $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
              echo "- **Emscripten:** $(emcc --version | head -1)"
              echo "- **SQLite Version:** ${version}"
              echo "- **SQLite Commit:** ${sqliteCommit}"
              echo ""
              echo "## SQLite Features Enabled"
              echo "- Session extension (changesets/sync)"
              echo "- Preupdate hooks"  
              echo "- Bytecode virtual table"
              echo "- FTS5 full-text search (in fts5/ variant)"
              echo ""
              echo "## Build Variants"
              echo ""
              echo "### Standard Builds"
              echo "- **wa-sqlite.mjs + .wasm**: Web/Worker build with all features"
              echo "- **wa-sqlite-async.mjs + .wasm**: Async build for Promise-based usage"
              echo "- **wa-sqlite-jspi.mjs + .wasm**: JSPI build for JavaScript Promise Integration"
              echo "- **wa-sqlite.node.mjs + .wasm**: Node.js build"
              echo ""
              echo "### FTS5 Builds"
              echo "- **fts5/wa-sqlite.mjs + .wasm**: Web build with FTS5 full-text search"
              echo "- **fts5/wa-sqlite.node.mjs + .wasm**: Node.js build with FTS5"
              echo ""
              echo "## Session/Changeset API Available"
              echo "The following session functions are exported and available:"
              echo "- \`sqlite3session_create\` - Create session objects"
              echo "- \`sqlite3session_attach\` - Attach tables to sessions"
              echo "- \`sqlite3session_enable\` - Enable session recording"
              echo "- \`sqlite3session_changeset\` - Generate changesets"
              echo "- \`sqlite3session_delete\` - Clean up sessions"
              echo "- \`sqlite3changeset_start\` - Process changesets"
              echo "- \`sqlite3changeset_finalize\` - Finalize changeset processing"
              echo "- \`sqlite3changeset_invert\` - Invert changesets"
              echo "- \`sqlite3changeset_apply\` - Apply changesets"
              echo ""
              echo "## Build Script"
              echo "Generated via: \`nix build .#wa-sqlite-livestore\`"
              echo ""
              echo "## File Sizes"
              echo ""
              echo "### Standard Build Sizes"
              for f in dist/*.{mjs,wasm}; do
                if [ -f "$f" ]; then
                  size=$(ls -lah "$f" | awk '{print $5}')
                  gzip_size=$(gzip -c "$f" | wc -c | awk '{printf "%.1fK", $1/1024}')
                  brotli_size=$(brotli -c "$f" | wc -c | awk '{printf "%.1fK", $1/1024}')
                  echo "- **$(basename "$f")**: $size (gzip: $gzip_size, brotli: $brotli_size)"
                fi
              done
              echo ""
              echo "### FTS5 Variant Sizes"
              for f in dist/fts5/*.{mjs,wasm}; do
                if [ -f "$f" ]; then
                  size=$(ls -lah "$f" | awk '{print $5}')
                  gzip_size=$(gzip -c "$f" | wc -c | awk '{printf "%.1fK", $1/1024}')
                  brotli_size=$(brotli -c "$f" | wc -c | awk '{printf "%.1fK", $1/1024}')
                  echo "- **fts5/$(basename "$f")**: $size (gzip: $gzip_size, brotli: $brotli_size)"
                fi
              done
              echo ""
              echo "## Notes"
              echo "- All builds include session extension for data synchronization"
              echo "- mayCreate fixes applied to prevent filesystem errors"
            } > dist/README.md

            runHook postBuild
          '';

          installPhase = ''
            runHook preInstall
            cp -r . $out
            runHook postInstall
          '';

          meta = with pkgs.lib; {
            description = "wa-sqlite with session and FTS5 support for Livestore";
            homepage = "https://github.com/livestorejs/wa-sqlite";
            # fork of https://github.com/rhashimoto/wa-sqlite
            license = licenses.mit;
            platforms = platforms.all;
          };
        };

      in
      {
        packages = {
          default = waSqliteDerivation;
          wa-sqlite-livestore = waSqliteDerivation;
        };

        # Convenience app to build and update dist directory
        apps.build = {
          type = "app";
          program = toString (pkgs.writeShellScript "copy-dist" ''
            set -euo pipefail
            
            echo "Building wa-sqlite with session support and FTS5 variant..."
            
            # Build the derivation
            RESULT=$(nix build --no-link --print-out-paths)
            
            # Copy dist directory to current working directory
            if [ -d "$RESULT/dist" ]; then
              # Remove old dist with proper permissions handling
              if [ -d "./dist" ]; then
                chmod -R u+w ./dist
                rm -rf ./dist
              fi
              cp -r "$RESULT/dist" ./
              echo "✓ Build complete - dist directory regenerated with session support and FTS5 variant"
            else
              echo "ERROR: No dist directory found in build result"
              exit 1
            fi
          '');
        };

        # Default app for convenience  
        apps.default = self.apps.${system}.build;

        # Development shell
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            which
            tcl
            gcc
            wabt
            unzip
            openssl
            zip
            brotli
            gzip
          ] ++ (with pkgsUnstable; [
            emscripten
          ]);
        };
      }
    );
}