#!/usr/bin/env bash
set -euo pipefail

# wa-sqlite build script - builds WebAssembly SQLite with session and FTS5 support

REPO_ROOT=$(git rev-parse --show-toplevel)
TEMP_DIR=$(mktemp -d)

echo "Building wa-sqlite in temporary directory..." >&2

# Copy source to temp location (avoids @ symbol issues)
cp -r "$REPO_ROOT/packages/@livestore/wa-sqlite" "$TEMP_DIR/wa-sqlite"
cd "$TEMP_DIR/wa-sqlite"

# Setup build environment
export EM_CACHE="$TEMP_DIR/em-cache"
export HOME="$TEMP_DIR"
export DESTDIR="$TEMP_DIR"
mkdir -p "$EM_CACHE"

echo "Emscripten version:" >&2
emcc --version >&2

# Setup SQLite source in expected location from specific commit
mkdir -p cache/version-${SQLITE_VERSION} deps/version-${SQLITE_VERSION}
echo "Copying SQLite source..." >&2
cp -r "$SQLITE_SRC"/* cache/version-${SQLITE_VERSION}/

# Configure and build SQLite amalgamation with session support
cd cache/version-${SQLITE_VERSION}
chmod +x configure
echo "Configuring SQLite with session support..." >&2

# Configure SQLite (matching original wa-sqlite-livestore.nix)
./configure >&2

echo "Building SQLite amalgamation with session extension..." >&2

# Build amalgamation and ensure session extension is included
make sqlite3.c sqlite3.h >&2

# Verify that session functions are in the amalgamation
if ! grep -q "sqlite3session_create" sqlite3.c; then
  echo "ERROR: Session functions not found in SQLite amalgamation" >&2
  exit 1
fi

cp sqlite3.c sqlite3.h ../../deps/version-${SQLITE_VERSION}/
cd ../..

# Copy extension functions (from original build)
echo "Downloading extension functions..." >&2
curl -LsS 'https://www.sqlite.org/contrib/download/extension-functions.c?get=25' -o cache/extension-functions.c 2>&2
cp cache/extension-functions.c deps/extension-functions.c

# Comment out curl commands in Makefile since we provide sources
chmod u+w Makefile
sed -i "" "s/curl/#curl/g" Makefile

# Add Node.js build target to Makefile
cat >> Makefile <<'EOF'
dist/wa-sqlite.node.mjs: $(OBJ_FILES_DIST) $(JSFILES) $(EXPORTED_FUNCTIONS) $(EXPORTED_RUNTIME_METHODS)
	mkdir -p dist
	$(EMCC) $(EMFLAGS_DIST) $(EMFLAGS_INTERFACES) $(EMFLAGS_LIBRARIES) -s ENVIRONMENT=node $(OBJ_FILES_DIST) -o $@
EOF

mkdir -p dist
chmod 755 dist

# Build with FTS5 support first (only web and node variants, no async/jspi for FTS5)
echo "Building FTS5 variant..." >&2
make dist/wa-sqlite.mjs dist/wa-sqlite.node.mjs WASQLITE_EXTRA_DEFINES="-DSQLITE_ENABLE_BYTECODE_VTAB -DSQLITE_ENABLE_SESSION -DSQLITE_ENABLE_PREUPDATE_HOOK -DSQLITE_ENABLE_FTS5" >&2
mkdir -p dist-fts5
mv dist/wa-sqlite* dist-fts5/

make clean >&2
chmod -R u+w dist/ || true

# Build standard variant with session support (only web and node, async/jspi will be added later)  
echo "Building standard variant with session support..." >&2
make dist/wa-sqlite.mjs dist/wa-sqlite.node.mjs WASQLITE_EXTRA_DEFINES="-DSQLITE_ENABLE_BYTECODE_VTAB -DSQLITE_ENABLE_SESSION -DSQLITE_ENABLE_PREUPDATE_HOOK" >&2

# Build async and jspi variants for standard build (before organizing FTS5)
echo "Building async and jspi variants..." >&2
make dist/wa-sqlite-async.mjs dist/wa-sqlite-jspi.mjs WASQLITE_EXTRA_DEFINES="-DSQLITE_ENABLE_BYTECODE_VTAB -DSQLITE_ENABLE_SESSION -DSQLITE_ENABLE_PREUPDATE_HOOK" >&2

# Organize FTS5 variant (only move web and node variants)
mkdir -p dist/fts5
mv dist-fts5/wa-sqlite.mjs dist/fts5/wa-sqlite.mjs
mv dist-fts5/wa-sqlite.wasm dist/fts5/wa-sqlite.wasm  
mv dist-fts5/wa-sqlite.node.mjs dist/fts5/wa-sqlite.node.mjs
mv dist-fts5/wa-sqlite.node.wasm dist/fts5/wa-sqlite.node.wasm
rm -rf dist-fts5

# Apply mayCreate fixes to all .mjs files
echo "Applying mayCreate fixes..." >&2
for file in dist/*.mjs dist/fts5/*.mjs; do
  if [ -f "$file" ]; then
    sed -i "" "
      /mayCreate(dir, name) {/,/FS.lookupNode(dir, name);/ c\\
mayCreate(dir, name) {\\
    var node\\
    try {\\
      node = FS.lookupNode(dir, name);
      " "$file"
  fi
done

# Apply minified version fixes
for file in dist/*.mjs dist/fts5/*.mjs; do
  if [ -f "$file" ]; then
    sed -i "" "s/mayCreate(dir,name){try{var node=FS.lookupNode(dir,name)/mayCreate(dir,name){var node;try{node=FS.lookupNode(dir,name)/g" "$file"
  fi
done

# Generate README with build information
echo "Generating build information README..." >&2
cat > dist/README.md <<EOF
# wa-sqlite Build Information

This dist directory was built with the following configuration:

## Build Environment
- **Built on:** $(date -u '+%Y-%m-%d %H:%M:%S UTC')
- **Emscripten:** $(emcc --version | head -1)
- **SQLite Version:** ${SQLITE_VERSION}
- **SQLite Commit:** $(cd cache/version-${SQLITE_VERSION} && git log -1 --format="%H" 2>/dev/null || echo "979a07af38c8fb1d344253f59736cbfa91bd0a66")

## SQLite Features Enabled
- Session extension (changesets/sync)
- Preupdate hooks  
- Bytecode virtual table
- FTS5 full-text search (in fts5/ variant)

## Build Variants

### Standard Builds
- **wa-sqlite.mjs + .wasm**: Web/Worker build with all features
- **wa-sqlite-async.mjs + .wasm**: Async build for Promise-based usage
- **wa-sqlite-jspi.mjs + .wasm**: JSPI build for JavaScript Promise Integration
- **wa-sqlite.node.mjs + .wasm**: Node.js build

### FTS5 Builds
- **fts5/wa-sqlite.mjs + .wasm**: Web build with FTS5 full-text search
- **fts5/wa-sqlite.node.mjs + .wasm**: Node.js build with FTS5

## Session/Changeset API Available
The following session functions are exported and available:
- \`sqlite3session_create\` - Create session objects
- \`sqlite3session_attach\` - Attach tables to sessions  
- \`sqlite3session_enable\` - Enable session recording
- \`sqlite3session_changeset\` - Generate changesets
- \`sqlite3session_delete\` - Clean up sessions
- \`sqlite3changeset_start\` - Process changesets
- \`sqlite3changeset_finalize\` - Finalize changeset processing
- \`sqlite3changeset_invert\` - Invert changesets
- \`sqlite3changeset_apply\` - Apply changesets

## Build Script
Generated via: \`nix run ./nix/wa-sqlite-build#default\`

## File Sizes

### Standard Build Sizes
$(for f in dist/*.{mjs,wasm}; do
  if [ -f "$f" ]; then
    size=$(ls -lah "$f" | awk '{print $5}')
    gzip_size=$(gzip -c "$f" | wc -c | awk '{printf "%.1fK", $1/1024}')
    brotli_size=$(brotli -c "$f" | wc -c | awk '{printf "%.1fK", $1/1024}')
    echo "- **$(basename "$f")**: $size (gzip: $gzip_size, brotli: $brotli_size)"
  fi
done)

### FTS5 Variant Sizes  
$(for f in dist/fts5/*.{mjs,wasm}; do
  if [ -f "$f" ]; then
    size=$(ls -lah "$f" | awk '{print $5}')
    gzip_size=$(gzip -c "$f" | wc -c | awk '{printf "%.1fK", $1/1024}')
    brotli_size=$(brotli -c "$f" | wc -c | awk '{printf "%.1fK", $1/1024}')
    echo "- **fts5/$(basename "$f")**: $size (gzip: $gzip_size, brotli: $brotli_size)"
  fi
done)

## Notes
- All builds include session extension for data synchronization
- mayCreate fixes applied to prevent filesystem errors
EOF

# Return built dist directory
echo "$TEMP_DIR/wa-sqlite/dist"