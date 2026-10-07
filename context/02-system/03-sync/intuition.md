# Sync — Intuition

*For: contributors touching sync processors or providers · Assumes:
[../01-event-model/intuition.md](../01-event-model/intuition.md) · Covers:
the git-shaped mental model of convergence*

## It's git, minus merge commits

Think of each client as a git clone with local commits (pending events) on
top of origin (the upstream head). Sync is `pull --rebase` + `push`, forever:

```
pull:    origin advanced?  → re-parent my pending commits on the new head
push:    send my pending commits; backend either appends them in order
         or tells me I'm behind (→ pull first, then retry)
```

The reason this converges without a conflict UI: the sync backend is the
*single ordering authority*. Clients never negotiate order among themselves
— each client proposes events numbered on top of the head it knows, and the
backend accepts a push only if it chains onto the actual current head
(otherwise: "you're behind, pull first"). Like git, the server never
rewrites your commits; it just refuses non-fast-forward pushes. So there is
exactly one history, and every client eventually replays exactly that
history. Total order makes convergence trivial; all the machinery exists to
get everyone onto that order without losing local work (rebase, not
reject).

## One state machine, two boundaries

The whole protocol reduces to one pure data structure and one pure function:

```
SyncState = { pending, upstreamHead ≤ localHead }
merge(state, local-push | upstream-advance | upstream-rebase)
```

The same machine runs session⇄leader and leader⇄backend. A session treats
its leader exactly as the leader treats the backend: an upstream that
confirms, advances, or rebases you. Purity is the point — merge decisions
are deterministic and unit-testable in `e{n}` notation without any I/O.
The pure core lives in [01-syncstate/](./01-syncstate/spec.md); the two
drivers that feed it (queues, batching, retry, cursors) in
[02-processors/](./02-processors/spec.md).

## Two drivers, two variations

Each driver runs that machine with one owner, but neither is a classical
state machine (pure transitions, slow work handed back as output, one
queued message at a time, no answer to the sender):

| Classical rule | Leader | Client session |
| --- | --- | --- |
| Transitions are pure | Writes to disk via `LeaderPersistence` | Writes to SQLite itself |
| Slow work is returned as output | Starts background work itself | Hands it to the runner |
| Queued, and a turn never waits | Mailbox; a turn may wait | No queue; a turn never waits |
| Sender gets no answer | Acknowledged later | Answered immediately |

The leader is a mailbox machine whose turns may do slow work: it waits for
the durable write inside the turn, and backend I/O reports back as new
messages. The session cannot queue, because `store.commit` must return with
the change applied, so every turn finishes on the spot and a runner does all
the waiting, reporting back as messages. In both, a late answer from
superseded work is ignored. Details:
[02-processors/](./02-processors/spec.md).

## Failure is a normal input

Being offline, being behind (`ServerAheadError`), pushing a stale generation
— these are expected values in the error taxonomy, all answered by the same
recovery rule: rebase and retry. Only defects (`UnknownError`) escape that
loop. Pending events wait indefinitely; offline is a longer gap between
pulls, not a mode.

Providers only supply transport — `connect/pull/push/ping` over the
schema-defined encoding. Everything above the wire is owned here, which is
why one conformance suite can verify any provider
([../09-verification/](../09-verification/spec.md)); the Cloudflare
realization lives in [03-cf/](./03-cf/spec.md). The history-DAG /
compaction design (`sync/next/`) is experimental; see [spec.md](./spec.md).
