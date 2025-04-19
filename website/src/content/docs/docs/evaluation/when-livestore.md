---
title: When to use LiveStore (and when not)
sidebar:
  label: When to use LiveStore
  order: 3
description: Considerations when deciding to use LiveStore.
---

- Choosing a data layer for a local-first app is a big decision and should be considered carefully.
- On a high level, LiveStore can be a good fit if ...
  - you are looking for a principled data layer that works across platforms
  - you want to use SQLite for your queries
  - you like [event sourcing](/docs/reference/event-sourcing) to model data changes
  - you are working on a new app as LiveStore doesn't yet provide a way to [re-use an existing database](/docs/misc/faq#existing-database)
  - the current [state of the project](/docs/evaluation/state-of-the-project) aligns with your own timeline and requirements

## Evaluation exercise

A great way to evaluate whether LiveStore is a good fit for your application, is by trying to model your application events (and optionally state) schema.

## Database

- All the client app data should fit into a in-memory SQLite database
  - Depending on the target device having databases up to 1GB in size should be okay.
	- If you you have more data, you can consider segmenting your database into multiple SQLite database (e.g. segmented per project, workspace, document, ...).
	- You can either use the `storeId` option for the segmentation or there could also be a way to use the [SQLite attach feature](https://www.sqlite.org/lang_attach.html) to dynamically attach/detach databases.

## Reasons not to choose LiveStore for your application

- You want to build a more traditional client-server application with your primary data source being a remote server.
- You want a full-stack batteries-included solution (e.g. auth, storage, etc.). Technologies like [Jazz](https://jazz.tools) or [Instant](https://instantdb.com) might be a better fit.
- You don't like to model your data via read-write model separation/event sourcing or the trade-offs it involves.
- You're a new developer and are just getting started. LiveStore is a relatively advanced technology with many design trade-offs that might make most sense after you have already experienced some of the problems LiveStore is trying to solve.

## Other considerations

- How data flows / what's the source of truth?

## Syncing

- LiveStore's syncing system is designed for small/medium-level concurrency scenarios (e.g. 10s / low 100s of users collaborating on the same thing for a given eventlog).
	- Collaboration on multiple different eventlogs concurrently is supported and should be used to "scale horizontally".