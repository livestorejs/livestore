---
title: Anonymous user transition
description: How to transition an anonymous user to a logged in user
---

## Basic idea

- Locally choose a unique identifier for the user (e.g. via `crypto.randomUUID()`).
	- You might want to handle the very unlikely case that the identifier is not unique (collision) on the sync backend.
- Persist this identifier locally (either via a separate LiveStore instance or via `localStorage`).
- Use this identifier in the `storeId` for the user-related LiveStore instance.
	- Initially when the user is anonymous, the store won't be synced yet (i.e. no sync backend used in adapter).
	- As part of the auth flow, the LiveStore instance is now synced with the same `storeId` to a sync backend which will sync all local events to the sync backend making sure the user keeps all their data.

