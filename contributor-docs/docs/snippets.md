# Code snippets

We pre-render documentation examples with [Expressive Code Twoslash](https://twoslash.matthiesen.dev).
Snippet sources live under `docs/src/content/_assets/code/` and are bundled by the
`@local/astro-twoslash-code` toolkit before Astro renders the docs.

> ❗️  The authoritative reference for path handling and virtual file rules is the
> comment at the top of `packages/@local/astro-twoslash-code/src/cli/snippets.ts`.  Update that
> spec first if you touch the pipeline, and keep this document in sync with it.

## Authoring guidelines

- Keep every snippet in the snippet workspace (`docs/src/content/_assets/code/**`).  All imports
  must be relative (start with `./` or `../`) and include explicit extensions (`.ts`, `.tsx`, …).
- Organise larger examples as real files rather than MDX inline samples so they stay type-checked
  and easier to review.
- Avoid TypeScript workarounds such as `// @ts-ignore`, `// @ts-expect-error`, `// @errors`, or
  `as any`.  Bring real dependencies into `docs/src/content/_assets/code/package.json` instead.
- Use the TwoSlash cut marker (`// ---cut---`) to hide boilerplate while keeping the hidden region
  type-checked.  Place ambient declarations in sibling files; Twoslash includes them automatically.
- Worker/query suffixes (e.g. `?worker`) are supported—just keep the import relative with an
  explicit extension (`./file.worker.ts?worker`).

## Using snippets in docs

Import a snippet via `?snippet` and render the provided component:

```mdx
import WorkerSnippet from '../../_assets/code/getting-started/react-web/livestore.worker.ts?snippet'

<WorkerSnippet class="my-10" />
```

The loader exposes the rendered component as default export and raw metadata via `snippetData`.  The
component always reflects the pre-rendered bundle stored in `docs/node_modules/.astro-twoslash-code/`.

## Build pipeline

- `mono docs snippets build` walks the snippet workspace, constructs canonical virtual paths for
  each bundle, runs Twoslash, and writes JSON artefacts plus a manifest to
  `docs/node_modules/.astro-twoslash-code/`.
- Astro’s docs build invokes the same command automatically and fails if artefacts are missing or
  stale, so keep the cache committed for CI reproducibility.
- The cache format is stable: each artefact lists the bundle’s source files, their hashes, and the
  rendered HTML/diagnostics per file.  The manifest aggregates bundle hashes and global styles
  emitted by Expressive Code.

## Type checking & dependencies

- The snippet workspace has its own `tsconfig.json` aligned with the Twoslash compiler options
  (NodeNext modules/resolution, React JSX, `exactOptionalPropertyTypes`, etc.).  Use it when
  running targeted type checks.
- Install snippet-only dependencies with `pnpm --filter docs-code-snippets add <pkg>` so the
  regular docs app stays lean.

## Testing

- Always run `CI=1 bunx vitest run --config packages/@local/astro-twoslash-code/vitest.config.ts src/cli/snippets.render.test.ts`
  and `CI=1 mono docs snippets build` after modifying snippet code or the pipeline.
- Nightly/docs CI reuses the cached artefacts and will fail if the snippets no longer compile.
