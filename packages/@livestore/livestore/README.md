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

- [React Web](https://docs.livestore.dev/getting-started/react-web/)
- [Expo](https://docs.livestore.dev/getting-started/expo/)
- [Node](https://docs.livestore.dev/getting-started/node/)
- [Vue](https://docs.livestore.dev/getting-started/vue/)


## How LiveStore works

LiveStore is a fully-featured, client-centric data layer (replacing libraries like Redux, MobX, etc.) with a reactive embedded SQLite database powered by real-time sync (via event-sourcing).

![How LiveStore works](https://share.cleanshot.com/j1h8Z1P5+)

1. Instant, reactive queries to your local SQLite database (via built-in query builder or raw SQL).
2. Data changes are commited to the store, applied instantly and synced across clients.
3. Change events are persisted locally and synced across clients (and across tabs).
4. Events are instantly applied to the local database via materializers.
5. Query results are reactively and synchronously updated in the next render.
6. The LiveStore sync backend propagates changes to all connected clients.

If you’d like to learn more about how LiveStore works under the hood, feel free to check out our in-depth guides in the [documentation](https://docs.livestore.dev/evaluation/how-livestore-works/) and dive into topics like:

- [Concepts](https://docs.livestore.dev/reference/concepts/)
- [Event Sourcing](https://docs.livestore.dev/evaluation/event-sourcing/)
- [Design Decisions](https://docs.livestore.dev/evaluation/design-decisions/)
- [Performance](https://docs.livestore.dev/evaluation/performance/)
- [Date Modeling](https://docs.livestore.dev/data-modeling/)
- [Technology comparison](https://docs.livestore.dev/evaluation/technology-comparison/)

## License

Livestore is licensed under the [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).
