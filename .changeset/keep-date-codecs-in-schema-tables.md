---
'@livestore/common': patch
---

Fix `State.SQLite.table({ schema })` writing date columns it cannot read back. Column inference substituted each field's type-side AST, which dropped the encoding of codecs such as `Schema.DateFromString` and `Schema.DateFromMillis`; with no native storage left for a `Date`, the column became JSON text holding `'"2026-…"'` and every row read failed with `Expected a valid Date`. A field now keeps its own codec, so it stores its encoded form (ISO text, epoch integer) and decodes back to its type, and a bare `Schema.Date` is stored as ISO text. As a consequence a codec field such as `Schema.FiniteFromString` is stored in its encoded form (`text`), matching what `getColumnDefForSchema` already documented.
