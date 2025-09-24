# Changelog Guide

LiveStore is a data-layer library used by application developers. This changelog should help them understand version-to-version changes, assess risk before upgrading, and find migration guidance when behaviour shifts. Use the guide below to keep entries focused, accurate, and easy to scan.

## From the perspective of an application developer

The changelog should meet the goals of an application developer as follows:

### Goals

- I want to understand what changed in the release: which features were added, which bugs were fixed, and how behaviour shifted. I want to clearly understand the impact of those changes on my application.
- I want breaking changes highlighted with clear guidance so I know whether they affect my app and how to adapt.
- I want a changelog that is easy to scan and understand with links to pull requests or documentation so I can investigate details before upgrading.

### Anti-Goals

- I do not want marketing announcements / sales pitches.
- I do not want low-level implementation details unless I'm a contributor or maintainer.

## Principles

- Track every user-facing change in `CHANGELOG.md` and keep the upcoming release section current.
- Preserve an immutable history for past releases—only adjust sealed sections for editorial tweaks such as typo fixes or refreshed documentation links.
- Describe only the delta between consecutive versions. Avoid logging intermediate commits toward the same version.
- Lead with a concise summary of major highlights, followed immediately by explicit breaking change callouts.
- Use a functional structure for the main changes section—group updates by areas such as platform adapters, sync providers, core runtime, tooling, or documentation.
- Preface the upcoming release section with a short note pointing to the development docs and summarising how to install the dev build.
- Close each release with a maintainer-oriented section that follows the highlights and breaking changes, giving contributors deeper technical context.
- Require each pull request or commit that changes behaviour to update the upcoming section before merging.
- Include PR/issue links in the changelog.
- Thank external contributors by tagging them with `@<username>` in the changelog.

## Active Release Workflow

1. Keep an "Upcoming" (or next-version) section at the top of the changelog.
2. Add entries to the upcoming section as features, fixes, or documentation updates land.
3. Ensure reviewers verify that the changelog reflects the changes in the PR.
4. When preparing a release, confirm the upcoming section only contains changes merged since the last version tag.

## Upcoming Release Preface

- Start the upcoming section with a brief note linking to the development documentation that tracks the latest features.
- Include concise installation instructions for the dev build (mirroring the commands in `CHANGELOG.md` 0.4.0).
- Update these instructions whenever package names or install commands change, so testers can easily try the in-progress release.

## Release Layout

1. **Highlights:** A short subsection summarising the most important changes (usually 3 to 5 bullet points). Each bullet should mention the impacted surface and link to additional detail below.
2. **Breaking Changes:** Dedicated subsection describing required migrations or behavioural shifts. Provide actionable guidance for library users.
3. **Changes:** The primary body of the release notes. Organise subsections by user-facing functionality (for example Platform Adapters, Sync Providers, Core Packages, Tooling, Documentation) so readers can scan the areas they care about. Within each subsection, list changes with links to the relevant issues/PRs.
4. **Internal Changes:** Deep technical context, internal refactors, or operational guidance for maintainers and contributors. Keep this as the final section so they can dive into implementation details, rationale, and follow-up actions.

When adding new content, keep the subsections in this order and avoid inserting other categories above Highlights or Breaking Changes.

For the **Internal Changes** section, open with a short sentence that makes clear the content targets maintainers and contributors, then group items by theme (tooling, infrastructure, migrations).

### Changes Subsection Structure

Use the following order inside the Changes section to keep entries easy to scan.

1. Platform Adapters.
2. Sync Providers.
3. Core Runtime & Storage.
4. APIs & DX.
5. Bug Fixes.
6. Examples.
7. Experimental features.
8. Dependencies.

When listing Bug Fixes, group items by area.

- Schema & Migration.
- Query & Caching.
- SQLite & Storage.
- Concurrency & Lifecycle.
- TypeScript & Build.

## Highlight Selection

- Curate three to four bullets that represent the most impactful changes for application developers. Treat this as an editorial summary, not an exhaustive list.
- Prioritise new capabilities, platform support, or DX shifts that alter how apps integrate with LiveStore. Group smaller fixes under a single DX/quality highlight if needed. Include breaking changes only when they are a defining part of the release story.
- Provide precise, user-facing descriptions with issue/PR links so readers immediately know what changed and where to learn more. Name the bullet after the concrete capability or surface (for example “New Cloudflare adapter”) rather than broad categories like “Platform update”.

### Highlights to avoid

- Individual bug fixes unless they fundamentally change production risk.
- Anything non-user facing or library internal changes.

## Breaking Changes

- Document each breaking change with a clear before/after comparison. Use code snippets when possible. Fall back to concise text when code is not applicable.
- Call out migration steps so application developers know exactly how to adapt their code.
- Keep each item scoped to a single behavioural change and link to the supporting PR or documentation.

## Past Releases

- After publishing a release, move the upcoming section into a dated heading (for example `## 0.12.0 - 2025-09-15`).
- Only revisit sealed sections to fix typos or keep documentation links accurate. Capture other changes in the next upcoming section.

## Comparing Versions

- Focus each section on the difference from the previously released version.
- Summarise ongoing work under the upcoming section rather than recording every intermediate commit.
- Call out breaking changes with concise migration steps or references to supporting documentation.

## Writing Style

- Lead bullets with the impacted area in bold (for example `**Cloudflare adapter:**`) so readers can scan the scope quickly.
- Keep entries to one or two short sentences. State the change in past tense, then describe current behaviour in present tense when that context helps application developers.
- Focus on user-facing APIs and behaviour. Use precise technical terms when they help developers act, link to the relevant issues, pull requests, or docs, and reserve internal implementation detail for the Internal Changes section. Describe capabilities from the library perspective (for example “LiveStore now accepts Effect schemas as table definitions”) instead of attributing intent to inputs.
- Avoid vague benefit statements (for example “streamlines everyday usage”). Explain the concrete behaviour or capability that changed so developers know what to adopt. Use established acronyms (like DX) when they keep the bullet concise without losing clarity. Skip filler phrases (for example “day-to-day workflows”) and focus on the specific capability delivered.
- Maintain a neutral, technical, factual tone aimed at application developers consuming an open-source library, and avoid marketing or celebratory phrasing.
- Apply consistent heading formatting, tense rules, and reference style across the release notes.

### Punctuation

- Avoid semicolons and en dashes (–) in prose. Prefer full stops.
- For ranges, write “to” (for example “3 to 5”).
- For asides, prefer short sentences or parentheses instead of dashes.

### Examples

- Do: `- **New Cloudflare adapter:** Added Durable Object sync transports. LiveStore now supports production Workers deployments (#451, #574).`
- Don't: `- **Cloudflare adapter:** We're thrilled to ship our revolutionary sync story for Cloudflare users!`

## Observations on Current Changelog

- `CHANGELOG.md` currently starts `0.4.0 (Unreleased)` with several feature subsections but no top-level Highlights summary.
- Breaking changes appear after multiple feature sections instead of immediately following the highlights.
- There is no dedicated maintainer section consolidating deeper technical detail.

Use these gaps, plus the new requirements to cite issues/PRs and thank external contributors, as a checklist when restructuring the upcoming release notes.
