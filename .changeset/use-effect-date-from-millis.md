---
'@livestore/utils': minor
---

Breaking: replace the LiveStore-specific `Schema.DateFromEpochMillis` export with Effect's built-in `Schema.DateFromMillis`.

Applications should rename `Schema.DateFromEpochMillis` usages to `Schema.DateFromMillis`. The encoded value remains an epoch-millisecond number and the decoded value remains a JavaScript `Date`.
