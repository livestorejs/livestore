---
title: Docs
description: Notes on contributing to the LiveStore docs
---

Please follow LiveStore's [guiding principles](/contributing/contributing#guiding-principles) when writing docs.

## Writing style

This project broadly tries to follow the [Prisma docs style guide](https://www.prisma.io/docs/about/style-guide/writing-style).

## Title casing for navigation items, pages and sections

All titles for navigation items, pages and sections are using regular sentence casing. This means that only the first word and proper nouns are capitalized.

### Example

Good:

```md
## This is the title of this section
```

Bad:

```md
## This is the Title of this Section
```

## Create proper frontmatter for every page

TBD

## Snippets

For snippet guidelines, see: `/contributor-docs/docs/snippets.md`

## Deploying the docs

- Run `direnv exec . mono docs deploy` to build and deploy the documentation to the dev domain (`https://dev.docs.livestore.dev`).
- Passing `--prod` targets the production domain (`https://docs.livestore.dev`) when you are on `main` (otherwise the command deploys using a branch alias).
- Use `--site=<slug>` if you need to override the default Netlify site name.
- Add `--purge-cdn` when you need to invalidate Netlify's CDN cache after deploying; this ensures new edge handlers or content-negotiation changes take effect immediately.
- CI automatically builds and deploys the docs: `main` updates `https://docs.livestore.dev`, `dev` updates `https://dev.docs.livestore.dev`, and feature branches publish to the dev domain behind a branch alias.
