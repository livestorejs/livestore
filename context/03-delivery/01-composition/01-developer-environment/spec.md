# Developer Environment — Spec

This document specifies portable and hermetic development lanes, shell
readiness, and setup diagnostics. It builds on
[requirements.md](./requirements.md).

## Status

Draft.

## Scope

Defines: portable development, automatic hermetic shell setup, explicit
source-validation gates, setup profiling, and local trace handling. Does not
define: individual example ports, the shared Effect-utils implementation, or
production observability.

## Development Lanes

```text
exclusive checkout
  |
  +-- portable lane -- Dockerfile -- finite cold-start oracle
  |                  `- Compose ---- bind-mounted interactive shell
  |
  `-- full lane ----- devenv ----- dependencies + generated sources
                     `- Nix ------- browsers, WASM, release, infrastructure
```

The portable lane is the default for ordinary TypeScript changes. The full
lane is an escalation target for capabilities whose correctness depends on the
hermetic repository toolchain. The two lanes share the committed pnpm lockfile
and source tree; they do not claim identical tool closures
([decision 0003](./.decisions/0003-two-development-lanes.md)).

| Capability | Portable lane | Full lane |
| --- | --- | --- |
| Frozen workspace install | Required | Required |
| Reference-aware TypeScript build | Required | Required |
| Stable core unit tests | Required | Required |
| Vite application build and development | Required | Required |
| Local Wrangler build | Required | Required |
| Docs source check | Required | Required |
| Browser and Playwright tests | Not provided | Required |
| Full docs build, including diagrams | Not provided | Required |
| Genie regeneration | Not provided | Required |
| wa-sqlite rebuild | Not provided | Required |
| Release and infrastructure operations | Not provided | Required |

## Portable Lane

The root `Dockerfile` is the executable cold-start contract. It starts from the
official Node 24 image, copies the Bun binary from the pinned official Bun
image, installs the pnpm version declared by `package.json#packageManager`
directly, and runs the finite capability set in the table above. It does not
install Nix, a browser, Genie, Git history, release credentials, or
infrastructure tools.

The root `compose.yaml` makes the same image interactive. The `development`
service bind-mounts the current checkout at `/workspace`, uses the caller's
`LOCAL_UID` and `LOCAL_GID` when supplied (with repository defaults for the
standard development host), and keeps package-manager state in a writable
temporary home. It intentionally declares no application ports. Because tools
write dependencies and build outputs through the bind mount, the checkout must
be exclusively owned by that developer or agent.

```bash
docker compose build
LOCAL_UID="$(id -u)" LOCAL_GID="$(id -g)" docker compose run --rm development
pnpm install --frozen-lockfile
```

The generated pull-request workflow contains an independent `minimal-dev` job
on a stock hosted Ubuntu runner. Its only preparation is checkout; `docker
build .` performs the gate. The generated repository ruleset requires the
stable `minimal-dev` context. The Dockerfile, workflow generator, generated
workflow, and generated ruleset are reviewed together when the contract
changes (LS.DEL.COMP.DEV-R03, R05, R06).

## Full Lane

The full lane begins with `devenv shell`. It owns browser installation, full
docs rendering, Genie and other generated sources, wa-sqlite's Nix/Emscripten
build, release workflows, infrastructure checks, and repository-wide parity.
Failing a portable command because one of these capabilities is absent is an
escalation signal, not permission to skip or approximate the check
(LS.DEL.COMP.DEV-R04).

## Full-Lane Shell Readiness

Shell entry establishes dependency and generated-source readiness through
`pnpm:install` and `genie:run`. It does not run the full TypeScript build.
TypeScript validation remains an explicit `ts:build` / `ts:check` gate in
developer and CI workflows, so source errors cannot delay or block access to
the diagnostic environment
([decision 0001](./.decisions/0001-separate-readiness-from-validation.md)).

## Setup Observability

`otel:profile:setup` is the canonical setup diagnostic. The shared Effect-utils
observability module runs the strict setup graph under devenv's native
`--trace-to` instrumentation and captures both native devenv spans and
Effect-utils task spans with `otelite`. Native spans own evaluation, scheduling,
and task lifecycle; Effect-utils spans refine the task execution beneath the
matching native task span. `otel:verify:setup` runs the bounded `setup:gate`
shape proof and is part of `check:all`.

Interactive telemetry uses Effect-utils automatic system-stack detection with
the worktree-local stack as fallback. Deterministic setup profiling uses
otelite's ephemeral HTTP and gRPC receivers. Effect-utils owns the
bootstrap-safe dual-transport lifecycle and common connected-tree assertions;
LiveStore configures its stable project identity and setup profile. Otelite
remains the source of truth for capture, schemas, and normalized inspection
([decision 0002](./.decisions/0002-compose-isolated-setup-observability.md)).

The E2E contract asserts a successful child, no rejected telemetry, one trace,
the native root and task spans, and the native `setup:gate` to Effect-utils
`devenv.task.exec` parent relationship. It does not enforce absolute duration.
Benchmark timings remain experiment evidence because host and cache state are
material inputs
([experiment 0001](./.experiments/0001-worktree-setup-and-trace.md)).

Setup captures are local diagnostic artifacts under the ignored `tmp/` tree.
They are not uploaded automatically. This keeps machine-local paths and command
metadata in a private-by-default evidence lane while stable task names,
outcomes, cache decisions, and durations remain queryable.
