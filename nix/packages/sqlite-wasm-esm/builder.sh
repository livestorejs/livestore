source $stdenv/setup

# echo $src
# ls $src
ls

cp -r $src/* .

# cd *-sqlite
ls

chmod -R 777 .

mkdir dist

cp src/sqlite3.d.ts dist
cp src/sqlite3-wrapper.js dist/sqlite3-wrapper.js
cp $sqlitelib/sqlite3.wasm dist
cp $sqlitelib/sqlite3-opfs-async-proxy.js dist

cat <(echo "export default function install(wrapper) {") $sqlitelib/sqlite3.js <(echo "wrapper.self = self; }") > dist/sqlite3.js

# Remove `self.`
sed -i "s|const originalInit = self.sqlite3InitModule;|const originalInit = sqlite3InitModule;|g" dist/sqlite3.js

# Use `new URL()` pattern which can be understood by Vite
sed -i "s|wasmBinaryFile = 'sqlite3.wasm';|wasmBinaryFile = new URL('sqlite3.wasm', import.meta.url).href;|g" dist/sqlite3.js
sed -i "s|.uri = 'sqlite3.wasm'|.uri = new URL('sqlite3.wasm', import.meta.url).href|g" dist/sqlite3.js
sed -i "s|const W = new Worker(options.proxyUri);|const W = new Worker(new URL(options.proxyUri, import.meta.url));|g" dist/sqlite3.js
sed -i "s|\"sqlite3-opfs-async-proxy.js\";|new URL('sqlite3-opfs-async-proxy.js', import.meta.url).href;|g" dist/sqlite3.js

# comment out as not neccessary with Vite
sed -i "s|wasmBinaryFile = locateFile(wasmBinaryFile)|// wasmBinaryFile = locateFile(wasmBinaryFile)|g" dist/sqlite3.js

# prevent warn log message (even during dev)
sed -i "s|console.warn(\"Installing sqlite3|// console.warn(\"Installing sqlite3|g" dist/sqlite3.js

# Use `new URL()` pattern which can be understood by Vite
sed -i "s|Module\['locateFile'\] = function(path, prefix) {|Module\['locateFile'\] = function(path, prefix) { return new URL(path, import.meta.url).href;|" dist/sqlite3.js

cp -r dist $out
