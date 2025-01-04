---
title: SQLite in LiveStore
description: Notes on how to use SQLite in LiveStore
sidebar:
  order: 21
---

LiveStore heavily relies on SQLite.

- LiveStore relies on the following SQLite extensions to be available: `-DSQLITE_ENABLE_BYTECODE_VTAB -DSQLITE_ENABLE_SESSION -DSQLITE_ENABLE_PREUPDATE_HOOK`
  - [bytecode](https://www.sqlite.org/bytecodevtab.html)
  - [session](https://www.sqlite.org/sessionintro.html) (incl. preupdate)

- For web / node adapater:
  - LiveStore uses [a fork](https://github.com/livestorejs/wa-sqlite) of the [wa-sqlite](https://github.com/rhashimoto/wa-sqlite) SQLite WASM library.
  - In the future LiveStore might use a non-WASM build for Node/Bun/Deno/etc.
- For Expo adapter:
  - LiveStore uses the official expo-sqlite library which supports LiveStore's SQLite requirements.