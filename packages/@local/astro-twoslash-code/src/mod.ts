export type {
  BuildSnippetsOptions,
  CreateSnippetsCommandOptions,
  WatchSnippetsOptions,
  WatchSnippetsRebuildInfo,
} from './cli/snippets.ts'
export { buildSnippets, createSnippetsCommand, watchSnippets } from './cli/snippets.ts'
export { prepareMultiCodeData } from './components/multi-code.ts'
export type { ExpressiveCodePluginDescriptor, TwoslashRuntimeOptions } from './expressive-code.ts'
export type { AstroTwoslashCodeOptions } from './integration/astro-twoslash-code.ts'
export { createAstroTwoslashCodeIntegration } from './integration/astro-twoslash-code.ts'
export type {
  TwoslashSnippetFile,
  TwoslashSnippetGlobals,
  TwoslashSnippetPayload,
  TwoslashSnippetPluginOptions,
  TwoslashSnippetRenderedEntry,
} from './vite/vite-plugin-snippet.ts'
export { createTwoslashSnippetPlugin } from './vite/vite-plugin-snippet.ts'
