export type { BuildSnippetsOptions, CreateSnippetsCommandOptions } from './cli/snippets.ts'
export { buildSnippets, createSnippetsCommand } from './cli/snippets.ts'
export { prepareMultiCodeData } from './components/multi-code.ts'
export type { AstroTwoslashCodeOptions } from './integration/astro-twoslash-code.ts'

export { createAstroTwoslashCodeIntegration } from './integration/astro-twoslash-code.ts'
export type { TwoslashSnippetPluginOptions } from './vite/vite-plugin-snippet.ts'
export { createTwoslashSnippetPlugin } from './vite/vite-plugin-snippet.ts'
