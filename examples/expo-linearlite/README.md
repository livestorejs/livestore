# Welcome to Linear Mobile

An example app built with [LiveStore](https://livestore.dev/) and [Expo](https://docs.expo.dev/)

## How to run it

1. Clone this repo
2. Navigate to the linearlite-mobile folder
3. Install dependencies with `bun`
   ```
   bun install
   ```
4. Create a development build by running
   ```
   bunx expo prebuild
   ```
5. Run the app
   ```
   # iOS
   bunx expo run:ios

   # Android
   bunx expo run:android
   ```

Learn more about [LiveStore](https://livestore.dev/) and [Expo](https://docs.expo.dev/)

## Cloudflare Sync (optional)

To enable syncing via Cloudflare (same setup as the Expo TodoMVC example):

1. Start the Cloudflare Worker locally
  ```
  pnpm wrangler:dev
  ```
  This serves the sync backend on `http://localhost:8787`.

2. Run the app with the sync URL
  ```
  # fish-compatible one-liner
  env EXPO_PUBLIC_LIVESTORE_SYNC_URL=http://localhost:8787 pnpm start
  ```

The app will connect to the worker using WebSocket sync.
