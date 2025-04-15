---
title: Events Schema
sidebar:
  order: 2
---

```ts
import { Events, Schema, sql } from '@livestore/livestore'

export const todoCreated = Events.synced({
  name: 'todoCreated',
  schema: Schema.Struct({ id: Schema.String, text: Schema.String }),
})

export const todoCompleted = Events.synced({
  name: 'todoCompleted',
  schema: Schema.Struct({ id: Schema.String }),
})
```