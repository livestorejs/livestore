import ts from 'typescript'
import rawClientSource from './multi-code-client.ts?raw'

/**
 * Produces an inlineable JavaScript payload for `multi-code-client.ts`.
 *
 * Rationale:
 *   - `MultiCode.astro` needs a browser-ready module during static builds;
 *     importing the client with `?url` shipped raw TypeScript and broke the
 *     tabs after deployment.
 *   - Vite's `?raw` loader gives us the original TypeScript source so we can
 *     transpile it once per process and reuse the cached output for every
 *     multi-code block rendered on the same page.
 */

let cachedModule: string | null = null

const compilerOptions: ts.TranspileOptions['compilerOptions'] = {
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ES2020,
}

export const loadMultiCodeClientModule = async (): Promise<string> => {
  if (cachedModule !== null) {
    return cachedModule
  }

  const transpiled = ts.transpileModule(rawClientSource, { compilerOptions })
  cachedModule = transpiled.outputText
  return cachedModule
}
