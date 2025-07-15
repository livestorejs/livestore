# @livestore/sqlite-wasm

## Export Conditions

```json
"./load-wasm": {
  "types": "./dist/load-wasm/mod.browser.d.ts",
  "browser": "./dist/load-wasm/mod.browser.js",
  "worker": "./dist/load-wasm/mod.browser.js",
  "node": "./dist/load-wasm/mod.node.js",
  "default": "./dist/load-wasm/mod.browser.js"
}
```

- **`browser`**: Web environments, uses browser APIs
- **`worker`**: Web workers, ensures browser version is used (used by Vite)
- **`node`**: Node.js environments (CI tests), uses Node.js APIs  
- **`default`**: Fallback to browser version

Order matters - browser/worker first ensures Vite web worker builds resolve correctly.