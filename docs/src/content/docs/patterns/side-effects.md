---
title: Side effect
description: How to run side-effects for LiveStore events
---

TODO: Document how to safely run side-effects as response to LiveStore events.

Notes for writing those docs:
- Scenarios:
  - Run side-effect in each client session
  - Run side-effect only once per client (i.e. use a lock between client sessions)
  - Run side-effect only once globally (will require some kind of global transaction)
- How to deal with rollbacks/rebases
- Allow for filtering events based on whether they have been confirmed by the sync backend or include unconfirmed events
