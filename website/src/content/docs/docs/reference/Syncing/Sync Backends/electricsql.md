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

We might support this use case in the future, you can follow the progress [here](https://github.com/livestorejs/livestore/issues/286). Please share any feedback you have on this use case there.

### Why do I need my own API endpoint in front of the ElectricSQL server?

The API endpoint is used to proxy pull/push requests to the ElectricSQL server in order to implement any custom logic you might need, e.g. auth, rate limiting, etc.
