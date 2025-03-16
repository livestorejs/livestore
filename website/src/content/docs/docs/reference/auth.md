---
title: Auth
sidebar:
  order: 21
---

LiveStore doesn't yet have any built-in authentication/authorization support, however it's possible to implement your own in the application layer.

## Passing auth payload to sync backend

You can use the `syncPayload` store option to pass an arbitrary payload to the sync backend.
