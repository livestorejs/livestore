---
title: When to use LiveStore (and when not)
description: Considerations when deciding to use LiveStore.
---

## Database

- All the client app data should fit into a in-memory SQLite database
  - Depending on the target device having databases up to 1GB in size should be okay.
	- If you you have more data, you can consider segmenting your database into multiple SQLite database (e.g. segmented per project, workspace, document, ...).
	- You can either use the `schema.key` option for the segmentation or there could also be a way to use the [SQLite attach feature](https://www.sqlite.org/lang_attach.html) to dynamically attach/detach databases.

## Other considerations

- How data flows / what's the source of truth?