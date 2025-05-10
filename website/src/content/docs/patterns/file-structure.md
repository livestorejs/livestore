---
title: File Structure
---

While there are no strict requirements/conventions for how to structure your project (files, folders, etc), a common pattern is to have a `src/livestore` folder which contains all the LiveStore related code.

```
src/
	livestore/
		index.ts # re-exports everything
		schema.ts # schema definitions
		queries.ts # query definitions
		events.ts # event definitions
		...
	...
```
