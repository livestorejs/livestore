# 0003 — Portable development capability boundary

Date: 2026-08-21

## Question

Which development capabilities work from the canonical Docker environment
without adding Nix, devenv, megarepo tooling, browsers, Git history, custom
launchers, or credentials?

## Method

- Used the 2026-08-20
  [developer setup discussion](https://app.notion.com/p/schickling/3c2e3d41f4a380b58b07daa038191f3e)
  as qualitative admission evidence. It reported roughly an hour for an
  initial Nix setup with a large download and proposed conventional coverage
  for the TypeScript-heavy majority. These are participant observations and a
  directional estimate, not benchmark measurements.
- Built the root Dockerfile from a clean Linux/amd64 context using the official
  Node 24 and Bun 1.3.13 images and directly installed repository-pinned pnpm
  11.8.0.
- Ran each candidate in a disposable container and classified the first
  boundary failure rather than installing another tool.
- Exercised Compose against a disposable source copy as UID 1000 and GID 100,
  including a fresh bind-mounted install and representative checks.
- Avoided deploy, publish, release mutation, credentials, and external service
  writes.

## Result

| Capability | Result | Evidence |
| --- | --- | --- |
| Frozen install | PASS | 36 workspaces; 2,600 packages; 2,653 supply-chain entries verified |
| Reference-aware core TypeScript build | PASS | `tsc -b packages/@livestore/livestore` |
| Stable core unit suite | PASS | 20 files; 271 tests; 1.75s Vitest duration in the expanded oracle |
| Vite application build | PASS | Worker and client bundles, including committed wa-sqlite WASM |
| Vite development server | PASS | Ready in 1.557s; HTTP 200 from the container |
| Local Wrangler build | PASS | Dry-run bundle with Durable Object bindings; no credentials or mutation |
| Docs source check | PASS | 30 Astro files; zero errors, warnings, or hints; 12.590s standalone |
| Full docs build | FAIL | 158 snippets rendered, then Puppeteer Chrome was absent after 399.007s |
| Playwright test | FAIL | Chromium headless-shell absent after 3.297s |
| Genie regeneration | FAIL | Genie CLI absent after 0.338s |
| wa-sqlite rebuild | FAIL | Nix/Emscripten build closure absent |
| Changesets history status | CONDITIONAL | pnpm command present; Git binary and `.git` history absent |
| Infrastructure check | FAIL | Nix absent |
| Contrib composition | NO VERDICT | Core experiment did not materialize or build the external contrib checkout |

The discussion also identified unfamiliarity and perceived host intrusion on
macOS, concern that a portable path could become tool-by-tool whack-a-mole, and
the need to use contributor feedback to revisit the boundary. These findings
shape admission and maintenance policy; they are not container performance
results.

The initial finite Docker oracle completed an uncached build in 101.8s. The
expanded oracle, including the full stable core suite, Vite build, Wrangler
build, and docs check, completed uncached in 115.445s. Image export represented
roughly 42s of the expanded measurement.

The full docs attempt sampled approximately 3.15 GiB memory and 235% peak CPU
before failing at the browser boundary. It transferred only kilobytes of
network traffic before that failure. These are diagnostic observations, not
portable resource ceilings.

The disposable Compose loop passed a fresh frozen install, reference-aware
TypeScript build, focused unit test, and docs check through the bind mount as
the configured non-root owner.

A subsequent oracle run invoked the shared admission bootstrap and completed
the same finite bar with Node v24.19.0, pnpm 11.8.0, and Bun 1.3.13. The build
steps completed in 53.1s and image export in 32.8s on the sampled warm-host
container cache; these timings are evidence, not performance requirements.

## Conclusion

The portable lane can reliably own frozen installation, ordinary TypeScript
work, stable core unit tests, representative Vite build/development, local
Wrangler builds, and docs source checking without another tool layer.

Browser execution, full docs rendering, generated-source regeneration,
wa-sqlite rebuilding, release-history operations, and infrastructure checks
cross a material tool or state boundary. They remain full-lane capabilities;
their absence must stay visible rather than being converted into skipped or
weakened portable checks. Contrib composition remains unclaimed until it has
its own clean-checkout evidence.

## VRS Impact

This evidence establishes the portable capability set in
LS.DEL.COMP.DEV-R03, the escalation boundary in LS.DEL.COMP.DEV-R04, and the
Docker/Compose mechanics in the developer-environment spec. It does not support
claiming browser, generation, release, infrastructure, or contrib composition
as portable capabilities.
