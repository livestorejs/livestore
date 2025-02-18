---
title: 'ElectricSQL'
---

## Example

See the [todomvc-sync-electric](https://github.com/livestorejs/livestore/tree/main/examples/src/todomvc-sync-electric) example.

## How the sync backend works

The initial version of the ElectricSQL sync backend will use the server-side Postgres DB as a store for the mutation event history.

Events are stored in a table following the pattern `mutation_log_${PERSISTENCE_FORMAT_VERSION}_${storeId}` where `PERSISTENCE_FORMAT_VERSION` is a number that is incremented whenever the `sync-electric` internal storage format changes.