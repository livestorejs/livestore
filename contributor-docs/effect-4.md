## Things to do when upgrading to Effect 4

- [ ] Improve logger replacement (e.g. in `make-leader-worker.ts`) in order to
      conditionally provide the logger only if it's replacing the default
      logger, not if there's a custom logger already provided.
- [ ] Refactor shutdown logic once `Mailbox.takeBetween` is available (@IMax153)
- [ ] Re-visit re-design of LiveStore table definitions using a more Effect Schema-native approach
  - [ ] Using an abstraction such as `Model` vs. embedded schema annotations (if tracked at the type level in v4)
    - [ ] @IMax153 currently following up with Giulio about this
  - [ ] Determine whether or not an opaque-first approach vs. verbose types are more appropriate