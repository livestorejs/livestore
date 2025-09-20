## Things to do when upgrading to Effect 4

- [ ] Improve logger replacement (e.g. in `make-leader-worker.ts`) in order to
      conditionally provide the logger only if it's replacing the default
      logger, not if there's a custom logger already provided.
- [ ] Refactor shutdown logic once `Mailbox.takeBetween` is available (@IMax153)