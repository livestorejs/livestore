---
title: Presence
description: How to implement presence functionality with LiveStore
---

LiveStore ships an ephemeral, non-persistent presence channel via
`@livestore/sync-cf/presence`. Unlike synced state, presence is broadcast-only
and never written to the eventlog or SQLite — ideal for high-frequency,
short-lived state.

Common presence use cases are:

- Track which users are online / in a room
- Track which users are typing (e.g. in a chat)
- Text cursor (similar to Google Docs)
- Cursor movements (similar to Figma)

See the [kanban with presence example](https://github.com/livestorejs/livestore-contrib)
for a full reference.
