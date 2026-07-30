---
"@livestore/utils": minor
---

Breaking: rename `Effect.tryAll` to `Effect.trySyncOrPromiseOrEffect`.

Promise rejections now fail with `Cause.UnknownError`, and returned Effects preserve their failure and service channels.
