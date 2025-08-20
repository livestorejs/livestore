{
  stdenv,
  fetchFromGitHub,
  pkgs,
  pkgsUnstable,
  waSQLiteSrc,
}:
let
  extension-functions = ./extension-functions.c;
in
stdenv.mkDerivation rec {
  pname = "wa-sqlite-livestore";
  version = "3.50.1";

  srcs = [
    waSQLiteSrc
    (fetchFromGitHub {
      owner = "sqlite";
      repo = "sqlite";
      rev = "979a07af38c8fb1d344253f59736cbfa91bd0a66";
      sha256 = "sha256-pFp1JMHYcb1YN/mG6+Ru2QETRtqzh/EheKVkjvCpnLo=";
      name = "sqlite-src";
    })
  ];

  sourceRoot = pname;

  unpackPhase = ''
    runHook preUnpack

    mkdir -p ${pname}
    cd ${pname}

    # Unpack the SQLite source to sqlite-src
    unpackFile ${builtins.elemAt srcs 1}

    # Copy wa-sqlite sources
    cp -r ${waSQLiteSrc}/* .

    # Set the source root
    sourceRoot=${pname}

    cd ..

    runHook postUnpack
  '';

  # Disable the automatic update of GNU config scripts
  dontUpdateAutotoolsGnuConfigScripts = true;

  nativeBuildInputs = [
    pkgs.which # needed for Make file
    pkgs.tcl
    pkgs.gcc
    pkgs.wabt
    pkgsUnstable.emscripten
    pkgs.unzip
    pkgs.openssl
    pkgs.zip
  ];

  # unpackPhase = ''
  # mkdir -p ${pname}
  # echo $PWD
  #   cp -r ${wa-sqlite}/* ${pname}
  # ls -la
  # ls -la ${pname}
  # '';

  configurePhase = ''
      echo "Emscripten version:"
      emcc --version


      pwd
      ls -la

      mkdir -p cache/version-${version}
      cp -r ./sqlite-src/* ./cache/version-${version}

      cp ${extension-functions} ./cache/extension-functions.c

      # Since we provide the source code via Nix, we don't need to download it
      # comment out all `curl` commands in `Makefile` of wa-sqlite
      chmod u+w Makefile # Ensure we have write permissions for the Makefile
      sed -i 's/curl/#curl/g' Makefile

      # Add `dist/wa-sqlite.node.mjs` to end of `Makefile` of wa-sqlite
      # Note: We use EMFLAGS_DIST to ensure memory growth is enabled (via EMFLAGS_COMMON)
      # This allows the WASM heap to grow dynamically at runtime, preventing "Cannot enlarge memory arrays" errors
      # when working with databases larger than the initial 16MB allocation
      cat >> Makefile <<EOF
    dist/wa-sqlite.node.mjs: \$(OBJ_FILES_DIST) \$(JSFILES) \$(EXPORTED_FUNCTIONS) \$(EXPORTED_RUNTIME_METHODS)
    ''\tmkdir -p dist
    ''\t\$(EMCC) \$(EMFLAGS_DIST) \$(EMFLAGS_INTERFACES) \$(EMFLAGS_LIBRARIES) -s ENVIRONMENT=node \$(OBJ_FILES_DIST) -o \$@
    EOF

      cat Makefile
  '';

  buildPhase = ''
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

      mkdir -p dist/fts5
      mv dist-fts5/wa-sqlite* dist/fts5
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

  '';

  installPhase = ''
    cp -r . $out
  '';
}
