---
title: Design Decisions
description: Design decisions and trade-offs made in the development of LiveStore
sidebar:
  order: 1
---

## Goals

- Fast, synchronous, transactional, and reactive state management
- Global state is eventually consistent
- Persistent storage
- Syncing
- Convenient schema migrations
- Great devtools

## Major Design Decisions

- Based on [event-sourcing](/reference/event-sourcing) (implying a read/write model separation)
- Using SQLite for state management over JavaScript implementations
  - There are many benefits to using SQLite for state management, including performance, reliability, and ease of use.
- Run in-memory SQLite in main-thread to enable synchronous queries
  - Usually LiveStore is used with a second SQLite database for persistence running in a separate thread (e.g. web worker)
  - Running SQLite additionally in the main-thread however also means each tab uses extra memory.
- The current implementation of LiveStore assumes that the data is small enough to fit in memory. However, SQLite is very efficient so this should work for many use cases and apps.
- LiveStore implements a Signals-based reactivity system based on the ideas of Adapton for incremental computation
- The goal is to keep LiveStore syncing provider agnostic so you can use the right syncing provider for your use case.