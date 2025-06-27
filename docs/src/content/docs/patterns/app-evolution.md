---
title: App Evolution
description: How to evolve your app and roll out new app versions
---

When building an app with LiveStore, you'll need to keep some things in mind when evolving your app.

## Schema changes

### State schema changes

Generally any kind of changes to your state schema (e.g. SQLite tables, ...) can be done at any time without any further considerations assuming the event materializer is updated to support the new schema.

### Event schema changes

Event schema changes require a bit more consideration. Changes to the event schema should generally be done in a backwards-compatible way. See [Event schema evolution](/reference/events/#schema-evolution) for more details.

## Parallel different app versions

In scenarios where you have multiple app versions rolled out in parallel (e.g. app version v3 with event schema v3 and app version v4 with event schema v4), you'll need to keep the following in mind:

App instances running version 4 might commit events that are not yet supported by version 3. Your app needs to decide how to handle this scenario in one of the following ways:

- Ignore unknown events
- Cause an error in the app for unknown events
- Handle events with a "catch all" event handler
- Let app render a "app update required" screen. App can still be used in read-only mode.
- ...
