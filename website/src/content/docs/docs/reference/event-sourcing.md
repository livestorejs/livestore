---
title: Event Sourcing
description: Why and how LiveStore uses event sourcing for data flow, syncing and migrations.
sidebar:
  order: 8
---

- Similar to Redux but persisted and synced across devices
- Core idea: Separate read vs write model
  - Read model: App database (i.e. SQLite)
  - Write model: Ordered log of all mutation events
- Related topics
  - Domain driven design
- Benefits
  - Simple mental model
  - Scalable
  - Flexible
    - You can easily evolve the read model based on your query patterns as your app requirements change over time
	- Automatic migrations of the read model (i.e. app database)
    - Write model can also be evolved (e.g. via versioned mutations and optionally mapping old mutations to new ones)
  - History of all state changes is captured (e.g. for auditing and debugging)
	- Foundation for syncing
- Downsides
  - Slightly more boilerplate to manually define mutations
  - Need to be careful so eventlog doesn't grow too much

## Further reading

- [The Log: What every software engineer should know about real-time data's unifying abstraction](https://engineering.linkedin.com/distributed-systems/log-what-every-software-engineer-should-know-about-real-time-datas-unifying)