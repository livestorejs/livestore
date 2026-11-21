---
title: Rust client
sidebar:
  order: 30
  badge:
    text: Experimental
    variant: caution
---

The Rust client is a native LiveStore client written in Rust. It is not an adapter for the TypeScript client: it is a port of the store, the leader and the sync logic. It syncs with the same Cloudflare sync backend as the web client, so Rust apps and web apps can share a store.

The code lives in [`livestore-contrib/rust`](https://github.com/livestorejs/livestore-contrib/tree/main/rust).

## Installation

The crates are not on crates.io yet. Add them as git dependencies and pin a commit:

```toml
[dependencies]
livestore = { git = "https://github.com/livestorejs/livestore-contrib", rev = "<commit>" }
livestore-schema = { git = "https://github.com/livestorejs/livestore-contrib", rev = "<commit>" }
livestore-sync = { git = "https://github.com/livestorejs/livestore-contrib", rev = "<commit>" }
livestore-sync-cf = { git = "https://github.com/livestorejs/livestore-contrib", rev = "<commit>" }
serde = { version = "1", features = ["derive"] }
tokio = { version = "1.47", features = ["rt-multi-thread", "macros"] }
```

## Events

Each event is a struct. `#[derive(Event)]` builds its definition, including the args schema, from the struct:

```rust
use livestore_schema::Event;
use serde::{Deserialize, Serialize};

#[derive(Event, Serialize, Deserialize)]
#[event(name = "v1.TodoCreated")]
pub struct TodoCreated {
    pub id: String,
    pub text: String,
}
```

The schema registers each event with its materializer, with `Schema::builder().materialize::<TodoCreated, _>(...)`. The [TodoMVC schema](https://github.com/livestorejs/livestore-contrib/tree/main/rust/crates/livestore-todomvc) is a full example.

A commit accepts only these typed events, so you cannot commit an unknown event name or args of the wrong shape.

## Example

```rust
use std::sync::Arc;
use livestore::{InMemoryAdapter, QueryInput, StoreOptions, SubscribeOptions, create_store, query_db};
use livestore_sync::{Storage, SyncOptions};
use livestore_sync_cf::{make_ws_sync, transport::ClientOptions};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let adapter = InMemoryAdapter {
        client_id: "my-client".into(),
        session_id: "my-session".into(),
        sync: Some(SyncOptions {
            backend: Some(make_ws_sync("wss://my-sync.workers.dev/sync", ClientOptions::default())),
            ..SyncOptions::default()
        }),
        leader_builder: Some(Arc::new(|builder| builder.storage(Storage::Folder("./data/my-store".into())))),
        ..InMemoryAdapter::default()
    };
    let store = create_store(StoreOptions::new(schema(), adapter.build(), "my-store")).await?;

    store.commit([TodoCreated { id: "t1".into(), text: "Buy milk".into() }])?;

    let todos = query_db(QueryInput::sql("SELECT id, text FROM todos"));
    let _sub = store.subscribe(&todos, |rows| println!("{rows:?}"), &SubscribeOptions::default());

    store.shutdown(None).await;
    Ok(())
}
```

`schema()` is your app's schema.

## How it runs

- Everything runs in your app's process. Each store has one leader, which runs as tasks on your tokio runtime. There are no workers.
- `create_store` must run inside a tokio runtime (1.47 or newer). After that, any thread can call `commit`, `query` and `subscribe`.
- `commit` and `query` are synchronous. A `subscribe` callback runs on the thread that changed the data. If your UI thread must not block, send the result to it.
- Each store keeps its data in its own folder. Only one leader can open a folder at a time. A second process needs its own folder.
- Windows of one app share a `Store`. Several stores in one app are independent.

## Limitations

- Only the Cloudflare sync backend is supported.
- No devtools support.
- Data is not encrypted on disk.

## Examples

The [examples](https://github.com/livestorejs/livestore-contrib/tree/main/rust/examples) are TodoMVC apps built with a terminal UI ([ratatui](https://ratatui.rs)), [GPUI](https://www.gpui.rs) and [rune](https://github.com/anomalyco/rune). They can share a store with the [web TodoMVC example](https://github.com/livestorejs/livestore/tree/main/examples/web-todomvc-sync-cf).
