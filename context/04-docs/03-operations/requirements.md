# Docs Operations — Requirements

Role: owns the operational contract of the docs site — deploy ownership,
the machine-readable docs surface for agents, and docs testing. Deploy
*mechanics* are owned by delivery release
([../../03-delivery/02-release/](../../03-delivery/02-release/requirements.md));
this node owns what the docs site must operationally provide.

## Context

Builds on [../requirements.md](../requirements.md). Grounded in
`docs/netlify.toml`, `docs/netlify/edge-functions/markdown-negotiation.ts`,
`scripts/src/commands/docs-export.ts`, and `docs/tests/`.

## Requirements

- **LS.DOCS.OPS-R01 Agents are a docs audience:** Every docs page is
  retrievable as plain markdown by machine clients (content negotiation via
  the `markdown-negotiation` edge function; bulk export via `docs-export`).
  Adopted 2026-07-16 (interview).
- **LS.DOCS.OPS-R02 Deploy ownership:** The docs site deploys through the
  delivery release pipeline (Netlify SSR + edge functions + CDN purge);
  mechanics live in the release runbook
  ([release-workflows-runbook.md](../../03-delivery/02-release/release-workflows-runbook.md)),
  and this node is notified via cross-reference when they change. Adopted
  2026-07-16 (interview).

## Open Design Questions

- **LS.DOCS.OPS-DQ1 Docs testing contract.** Docs testing today is a single
  Playwright workaround spec (`docs/tests/playwright/contextual-menu.spec.ts`);
  there is no link-check or build-smoke contract. What the docs site must
  prove per change is undecided.
