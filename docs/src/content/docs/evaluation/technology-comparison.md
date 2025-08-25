---
title: Technology comparison
description: How LiveStore compares to other related technologies
sidebar:
  order: 4
---

## TLDR of what sets LiveStore apart

- Uses combination of reactive, in-memory + synced, persisted SQLite for instant, synchronous queries
- Based on event-sourcing methodologies
- Client-centric (with great devtools)

## Other local-first/syncing technologies

To compare LiveStore with other local-first/syncing technologies, please see the [Local-First Landscape](https://www.localfirst.fm/landscape) resource.

## LiveStore vs Redux

LiveStore shares a lot of similarities with Redux in that sense that both are based on event-sourcing methodologies. Let's compare some of the core concepts:

- Redux actions are similar to LiveStore events: Both are used to describe "things that have happened"
- Redux views are similar to LiveStore's state (e.g. SQLite tables): Both are derived from the history of events/actions.
  - A major difference here is that LiveStore's state materialized as a SQLite database allows for a lot more flexibility via dynamic queries and aggregations vs Redux's static views.
- Redux reducers are similar to LiveStore's materializers: Both are used to transform events/actions into a final state.
- Both Redux and LiveStore are client-centric.
- Both Redux and LiveStore provide powerful [devtools](/reference/devtools).

While LiveStore can be used for the same use cases as Redux, LiveStore goes far beyond Redux in the following ways:

- LiveStore leverages SQLite for a more powerful state model allowing for flexible queries and aggregations with much simpler materialization logic.
- LiveStore supports client-persistence out of the box.
- LiveStore comes with a built-in [sync engine](/reference/syncing) syncing events between clients.

As a downside compared to Redux, LiveStore has a slightly larger bundle size.

## Other state management libraries

- Zustand
- Redux Toolkit (RTK)
- MobX
- Jotai
- Xstate
- Recoil
- TanStack Query
