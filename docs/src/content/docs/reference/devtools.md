---
title: Devtools
sidebar:
  order: 10
---

NOTE: Once LiveStore is open source, the devtools will be a [sponsor-only benefit](/misc/sponsoring).

## Features

- Real-time data browser with 2-way sync
  ![](https://share.cleanshot.com/F79hpTCY+)
- Query inspector
  ![](https://share.cleanshot.com/pkr2jqgb+)
- Eventlog browser
  ![](https://share.cleanshot.com/PTgXpcPm+)
- Sync status
  ![](https://share.cleanshot.com/VsKY3KnR+)
- Export/import
  ![](https://share.cleanshot.com/LQKYX6rq+)
- Reactivity graph / signals inspector
  ![](https://share.cleanshot.com/M26FHD6j+)
- SQLite playground
  ![](https://share.cleanshot.com/BcWmLmn2+)

## Adapters

### `@livestore/adapter-web`:

Requires the `@livestore/devtools-vite` package to be installed and configured in your Vite config:

```ts
// vite.config.js
import { livestoreDevtoolsPlugin } from '@livestore/devtools-vite'

export default defineConfig({
  // ...
  plugins: [
    livestoreDevtoolsPlugin({ schemaPath: './src/livestore/schema.ts' }),
  ],
})
```

The devtools can be opened in a separate tab (via e.g. `localhost:3000/_livestore/web). You should see the Devtools URL logged in the browser console when running the app.

#### Chrome extension

You can also use the Devtools Chrome extension.

![](https://share.cleanshot.com/wlM4ybFn+)

Please make sure to manually install the extension version matching the LiveStore version you are using by downloading the appropriate version from the [GitHub releases page](https://github.com/livestorejs/livestore/releases) and installing it manually via `chrome://extensions/`.

To install the extension:

1. **Unpack the ZIP file** (e.g. `livestore-devtools-chrome-0.3.0.zip`) into a folder on your computer.
2. Navigate to `chrome://extensions/` and enable **Developer mode** (toggle in the top-right corner).
3. Click **"Load unpacked"** and select the unpacked folder or drag and drop the folder onto the page.

### `@livestore/adapter-expo`:

Requires the `@livestore/devtools-expo` package to be installed and configured in your metro config:

```ts
// metro.config.js
const { getDefaultConfig } = require('expo/metro-config')
const { addLiveStoreDevtoolsMiddleware } = require('@livestore/devtools-expo')

const config = getDefaultConfig(__dirname)

addLiveStoreDevtoolsMiddleware(config, { schemaPath: './src/livestore/schema.ts' })

module.exports = config
```

You can open the devtools by pressing `Shift+m` in the Expo CLI process and then selecting `@livestore/devtools-expo` which will open the devtools in a new tab.
  
### `@livestore/adapter-node`:

Devtools are configured out of the box for the `makePersistedAdapter` variant (note currently not supported for the `makeInMemoryAdapter` variant).

You should see the Devtools URL logged when running the app.