---
title: 'ElectricSQL'
---

## Example

See the [todomvc-sync-electric](https://github.com/livestorejs/livestore/tree/main/examples/src/todomvc-sync-electric) example.

## How the sync backend works

The initial version of the ElectricSQL sync backend will use the server-side Postgres DB as a store for the mutation event history.

Events are stored in a table following the pattern `mutation_log_${PERSISTENCE_FORMAT_VERSION}_${storeId}` where `PERSISTENCE_FORMAT_VERSION` is a number that is incremented whenever the `sync-electric` internal storage format changes.

## F.A.Q.

### Can I use my existing Postgres database with the sync backend?

Unless the database is already modelled as a mutation log following the `@livestore/sync-electric` storage format, you won't be able to easily use your existing database with this sync backend implementation.


