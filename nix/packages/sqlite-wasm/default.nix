{
  stdenv,
  fetchFromGitHub,
  pkgs,
}:

stdenv.mkDerivation {
  pname = "sqlite-wasm";
  version = "3.46.0";

  src = fetchFromGitHub {
    owner = "sqlite";
    repo = "sqlite";
    rev = "5fb718aaab631e6a7f750e5049aa6f1eb33fb4a8";
    sha256 = "sha256-ySHTmoONjoN965Q3OrYQRC6MiuCMDRvHnyRcjV6fa4Y=";
    # sha256 = lib.fakeSha256;
  };

  nativeBuildInputs = [
    pkgs.which # needed for Make file
    pkgs.tcl
    pkgs.gcc
    pkgs.wabt
    pkgs.emscripten
    pkgs.unzip
    pkgs.zip
  ];

  configurePhase = ''
    cp -r ${pkgs.emscripten}/share/emscripten/cache/ $TMPDIR/emscripten_cache_sqlite
    chmod u+rwX -R $TMPDIR/emscripten_cache_sqlite
    export EM_CACHE=$TMPDIR/emscripten_cache_sqlite

    ./configure
    # ./configure --enable-all

    # Add SQLite flags to `ext/wasm/api/sqlite3-wasm.c` (bytecode, session (incl. preupdate))
    # i.e. add `#define SQLITE_ENABLE_BYTECODE_VTAB`, ... to beginning of file
    sed -i '1s/^/#define SQLITE_ENABLE_BYTECODE_VTAB\n/' ext/wasm/api/sqlite3-wasm.c
    sed -i '1s/^/#define SQLITE_ENABLE_SESSION\n/' ext/wasm/api/sqlite3-wasm.c
    sed -i '1s/^/#define SQLITE_ENABLE_PREUPDATE_HOOK\n/' ext/wasm/api/sqlite3-wasm.c
  '';

  buildPhase = ''
    # Needed for `make`
    export DESTDIR="$PWD"

    # https://github.com/sqlite/sqlite/blob/master/ext/wasm/dist.make#L95
    make -C ext/wasm dist

    # TODO switch to `esm` target once fixed: https://sqlite.org/forum/forumpost/af308d69455db6b9eab2ceb9301ddbe085c8e549c6cdbe2dae6420a15e212386
    # make -C ext/wasm esm

    cp -r . $out
  '';
}
