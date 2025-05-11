---
title: Data Modeling
description: How to model data in LiveStore.
---

## Core idea

- Data modeling is probably the most important part of any app and needs to be done carefully.
- The core idea is to model the read and write model separately.
- Depending on the use case, you might also want to split up the read/write model into separate "containers" (e.g. for data-sharing/scalability/access control reasons).
  - There is no transactional consistency between containers.
- Caveat: Event sourcing is not ideal for all use cases - some apps might be better off with another approach (e.g. use CRDTs for rich text editing).

## Considerations for data modeling

- How much data do you expect to have and what is the shape of the data?
  - Some kind of data needs special handling (e.g. blobs or rich text)
- Access patterns (performance, ...)
- Access control
- Data integrity / consistency
- Sharing / collaboration
- Regulatory requirements (e.g. GDPR, audit logs, ...)

## TODO

- TODO: actually write this section
- questions to answer
  - When to split things into separate containers?
  - How do migrations work?
    - Read model migrations
    - Write model migrations
      - How to create new write models based on existing ones
        - Example: An app has multiple workspaces and you now want to introduce the concept of "projects" inside a workspace. You might want to pre-populate a "default workspace project" for each workspace.
