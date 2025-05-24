![LiveStore Logo](https://share.cleanshot.com/njfQBDqB+)

## What LiveStore does

- 🏰 Provide a powerful data foundation for your app.
- ⚡ Reactive query layer with full SQLite support.
- 🔌 Adapters for most platforms (web, mobile, server/edge, desktop).
- 📐 Flexible data modeling and schema management.
- 📵 Support true offline-first workflows.
- 💥 Custom merge conflict resolution.
- 🔄 Sync with a [supported provider](https://docs.livestore.dev/reference/syncing/sync-provider/cloudflare/) or roll your own.

## Getting Started

For a quick start, we recommend using our template app following the steps below.

**Set up project from template**

For existing projects, see [Existing project setup](https://docs.livestore.dev/getting-started/react-web/#existing-project-setup).

```sh
bunx tiged --mode=git git@github.com:livestorejs/livestore/examples/standalone/web-todomvc livestore-app
```

**Note:** Replace `livestore-app` with your desired app name. If you’re not using [Bun](https://bun.sh), you can use `pnpm dlx` or `npx` instead of `bunx`.

**Install dependencies**

It’s strongly recommended to use bun or pnpm for the simplest and most reliable dependency setup (see [note on package management](https://docs.livestore.dev/misc/package-management) for more details).

```sh
bun install
```

**Run dev environment**

```sh
bun dev
```

**Open browser**

Open [http://localhost:60000](http://localhost:60000) in your browser.

You can also open the LiveStore DevTools by going to [http://localhost:60000/_livestore](http://localhost:60000/_livestore).

## How LiveStore works

LiveStore is a fully-featured, client-centric data layer (replacing libraries like Redux, MobX, etc.) with a reactive embedded SQLite database powered by real-time sync (via event-sourcing).

![How LiveStore works](https://share.cleanshot.com/j1h8Z1P5+)

1. Instant, reactive queries to your local SQLite database (via built-in query builder or raw SQL).
2. Data changes are commited to the store, applied instantly and synced across clients.
3. Change events are persisted locally and synced across clients (and across tabs).
4. Events are instantly applied to the local database via materializers.
5. Query results are reactively and synchronously updated in the next render.
6. The LiveStore sync backend propagates changes to all connected clients.


## License

Livestore is licensed under the [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).
