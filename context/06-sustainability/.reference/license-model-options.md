# Reference — source-available / sustainability license options

External license families relevant to [LS.SUST-DQ1](../spec.md) (licensing
model). Captured 2026-07-17 as decision-support; not an endorsement, and not a
substitute for legal review before adopting any.

## Permissive open source (the core's status quo)

- **Apache-2.0 / MIT** — OSI-approved; unrestricted commercial use. LiveStore's
  core is Apache-2.0 today (LS.SUST-R01).

## Non-commercial-free / commercial-paid (source-available, not OSI)

- **PolyForm Noncommercial** — source is public; free for any non-commercial
  use; commercial use requires a separate license.
- **Fair Source / "Sustainable Use"** (e.g. n8n's Sustainable Use License) —
  free for internal/personal use; restricts offering the software as a
  competing commercial service. Source public; not OSI "open source".

## Time-delayed permissive (source-available now, OSS later)

- **BSL 1.1 (Business Source License)** — usage limits (commonly "no competing
  production service") until a per-release *change date*, then auto-converts to
  a named permissive license (Apache/MIT/GPL). Used by MariaDB, HashiCorp
  (Terraform, Vault), and Sentry (before FSL).
- **FSL (Functional Source License, by Sentry)** — non-compete + commercial-use
  restriction for two years per release, then converts to MIT or Apache-2.0. A
  simplified, fixed-window BSL variant.

## The OSI line (why scope matters)

Only permissive and copyleft OSI-approved licenses are "open source" in the
strict sense. Every source-available option above makes the source public but
is **not** OSI open source. Applying one to the *core* therefore changes whether
LiveStore can call itself "open source" at all — the identity fork in
LS.SUST-DQ1. Applying one only to the *devtools* (core stays Apache-2.0)
preserves the "open-source core" claim while making the devtools source-visible
rather than closed.
