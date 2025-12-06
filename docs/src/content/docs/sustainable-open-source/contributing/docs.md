---
title: Docs
description: Notes on contributing to the LiveStore docs
---

Please follow LiveStore's [guiding principles](/contributing/contributing#guiding-principles) when writing docs.

## Writing style

This project broadly tries to follow the [Prisma docs style guide](https://www.prisma.io/docs/about/style-guide/writing-style).

## Use regular sentence casing for titles of navigation item, pages and sections

All titles for navigation items, pages and sections are using regular sentence casing. This means that only the first word and proper nouns (e.g. "Cloudflare Workers" or "Cloudflare Durable Objects") are capitalized.

### Example 1

Good:

```md
## This is the title of this section
```

Bad:

```md
## This is the Title of this Section
```

### Example 2

Good:

```md
## This pages is about Cloudflare Workers
```

Bad:

```md
##  This pages is about cloudflare workers
```


## Create proper frontmatter for every page

Frontmatter is YAML metadata at the start of MD/MDX files (between `---` markers) that controls page rendering, navigation, and SEO.

### Required fields

- **`title`**: Page title used for the browser tab, search results, and page heading. Always required.
- **`description`**: Brief summary (150-160 characters) used for search snippets and social previews. Highly recommended for SEO.

### Optional fields

- **`sidebar`**: Controls sidebar navigation
  - `label`: Custom sidebar label (defaults to `title`)
  - `order`: Numeric sort order (lower numbers appear first)

### SEO impact

The `title` and `description` fields directly impact SEO:
- `title` becomes the `<title>` tag and search result headline
- `description` becomes the `<meta name="description">` tag and search snippet
- Both are used for Open Graph and Twitter Card previews
- OG images are auto-generated at `/og/{slug}.png` using these fields

### Examples

Minimal (title only):
```yaml
---
title: Getting started with LiveStore + React
---
```

With description and sidebar:
```yaml
---
title: Getting started with LiveStore + React
description: How to use LiveStore with React on the web.
sidebar:
  label: React web
  order: 1
---
```

## Snippets

For snippet guidelines, see: `/contributor-docs/docs/snippets.md`

## Deploying the docs

- Run `direnv exec . mono docs deploy` to build and deploy the documentation to the dev domain (`https://dev.docs.livestore.dev`).
- Passing `--prod` targets the production domain (`https://docs.livestore.dev`) when you are on `main` (otherwise the command deploys using a branch alias).
- Use `--site=<slug>` if you need to override the default Netlify site name.
- Add `--purge-cdn` when you need to invalidate Netlify's CDN cache after deploying; this ensures new edge handlers or content-negotiation changes take effect immediately.
- CI automatically builds and deploys the docs: `main` updates `https://docs.livestore.dev`, `dev` updates `https://dev.docs.livestore.dev`, and feature branches publish to the dev domain behind a branch alias.
