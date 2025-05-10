---
title: Effect
sidebar:
  order: 21
---

LiveStore itself is built on top of [Effect](https://effect.website) which is a powerful library to write production-grade TypeScript code. It's also possible (and recommended) to use Effect directly in your application code.

## Schema

LiveStore uses the [Effect Schema](https://effect.website/docs/schema/introduction/) library to define schemas for the following:

- Read model table column definitions
- Event event payloads definitions
- Query response types

For convenience, LiveStore re-exports the `Schema` module from the `effect` package, which is the same as if you'd import it via `import { Schema } from 'effect'` directly.

### Example

```ts
import { Schema } from '@livestore/livestore'

// which is equivalent to (if you have `effect` as a dependency)
import { Schema } from 'effect'
```
