---
title: Frequently Asked Questions
sidebar:
  label: FAQ
  order: 1
description: Frequently asked questions about LiveStore
---

### Does LiveStore have optimistic updates?

Yes and no. LiveStore doesn't have the concept of optimistic updates as you might know from libraries like [React Query](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates), however, any data update in LiveStore is automatically optimistic without the developer having to implement any special logic.

This provides the benefits of optimistic updates without the extra complexity by manually having to implement the logic for each individual data update (which can be very error prone).

### Does LiveStore have database transactions?

LiveStore runs on the client-side and handles transactions differently than traditional server-side databases. While materializers automatically run in transactions, global transactional behavior (often called "online transactions") needs to be explicitly modeled in your application logic.

### Can I use an ORM or query builder with LiveStore?

It's possible to use most ORMs/query builders with LiveStore (as long as they are able to synchronously generate SQL statements). You should also give the built-in LiveStore query builder a try. See [the ORM page](/patterns/orm) for more information.

### Is there a company behind LiveStore? How does LiveStore make money?

LiveStore is developed by [Johannes Schickling](https://github.com/schickling) and has been incubated as the foundation of [Overtone](https://overtone.pro) (a local-first music app). The plan is to keep the development of LiveStore as sustainable as possible via sponsorships and other paths (e.g. commercial licenses, paid consulting, premium devtools, etc).

### Is there a hosted sync backend provided by LiveStore?

No, LiveStore is designed to be self-hosted or be used with a 3rd party sync backend.

### Can I use my existing database with LiveStore? {#existing-database}

Not currently. LiveStore is built around the idea of event-sourcing which separates reads and writes. This means LiveStore isn't syncing your database directly but only the events that are used to materialize the database making sure it's kept in sync across clients.

However, we might provide support for this in the future depending on demand.

### What's the difference between clientId, sessionId, and userId?

- **sessionId**: Identifies a single LiveStore instance within a client (e.g., a browser tab). Sessions can persist (e.g., across tab reloads in web).
- **clientId**: A randomly generated identifier managed by LiveStore that identifies a client instance. Each client has its own unique clientId and can have one or multiple sessions.
- **userId**: Not a LiveStore concept. User identity must be handled at the application level through your events and application logic.

A single user might have multiple clients (e.g., using different browsers or devices), each with its own clientId. User identification should be modeled within your application domain.