---
title: ORM
description: How to use an ORM with LiveStore
---

- LiveStore has a built-in query builder which should be sufficient for most simple use cases.
- You can always fall back to using raw SQL queries if you need more complex queries.
- As long as the ORM allows supports synchronously generating SQL statements (and binding parameters), you should be able to use it with LiveStore.
- Supported ORMs:
  - [Knex](https://knexjs.org/)
	- [Kysely](https://kysely.dev/)
  - [Drizzle](https://orm.drizzle.team/)
  - [Objection.js](https://vincit.github.io/objection.js/)
- Unsupported ORMs:
  - [Prisma](https://www.prisma.io/) (because it's async)

## Example

```ts
// TODO (contribution welcome)
```

