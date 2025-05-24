# @livestore/livestore

LiveStore is a next-generation state management framework based on reactive SQLite and git-inspired syncing (via event-sourcing).

## What LiveStore does

- 🏰 Provide a powerful data foundation for your app.
- ⚡ Reactive query layer with full SQLite support.
- 🔌 Adapters for most platforms (web, mobile, server/edge, desktop).
- 📐 Flexible data modeling and schema management.
- 📵 Support true offline-first workflows.
- 💥 Custom merge conflict resolution.
- 🔄 Sync with a [supported provider](https://docs.livestore.dev/reference/syncing/sync-provider/cloudflare/) or roll your own.

## How LiveStore works

LiveStore is a fully-featured, client-centric data layer (replacing libraries like Redux, MobX, etc.) with a reactive embedded SQLite database powered by real-time sync (via event-sourcing).

![How LiveStore works](https://share.cleanshot.com/j1h8Z1P5)

1. Instant, reactive queries to your local SQLite database (via built-in query builder or raw SQL).
2. Data changes are commited to the store, applied instantly and synced across clients.
3. Change events are persisted locally and synced across clients (and across tabs).
4. Events are instantly applied to the local database via materializers.
5. Query results are reactively and synchronously updated in the next render.
6. The LiveStore sync backend propagates changes to all connected clients.

## Getting Started

## How Livestore works conceptually

![How Livestore works](https://share.cleanshot.com/k7y2486X+)

[![Discord](https://img.shields.io/badge/Discord-%235865F2.svg?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/RbMcjUAPd7)

## License

Livestore is licensed under the [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).
