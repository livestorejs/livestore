// @ts-check

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { shouldNeverHappen } from '@livestore/utils'
import { defineEcConfig } from 'astro-expressive-code'
import ecTwoSlash from 'expressive-code-twoslash'
import ts from 'typescript'

// Twoslash should see the same workspace layout as the snippet sources.
const moduleDir = path.dirname(fileURLToPath(import.meta.url))
let codeRoot = path.resolve(moduleDir, 'src/content/_assets/code')

// When bundled for `astro build`, this module lives under `.netlify/build/chunks`.
// In that case the relative lookup above misses the source tree, so fall back to
// the workspace root (exposed via $WORKSPACE_ROOT / process.cwd()).
if (!fs.existsSync(codeRoot)) {
  const workspaceRoot =
    process.env.WORKSPACE_ROOT ?? shouldNeverHappen(`WORKSPACE_ROOT is not set. Make sure to run 'direnv allow'`)
  codeRoot = path.resolve(workspaceRoot, 'docs/src/content/_assets/code')
}
const snippetTsconfigPath = path.join(codeRoot, 'tsconfig.json')

// Keep Twoslash compiler options in sync with the snippet workspace tsconfig.
const resolveCompilerOptions = () => {
  const configFile = ts.readConfigFile(snippetTsconfigPath, ts.sys.readFile)
  if (configFile.error) {
    const message = ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n')
    throw new Error(`Unable to read ${snippetTsconfigPath}: ${message}`)
  }

  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(snippetTsconfigPath),
    undefined,
    snippetTsconfigPath,
  )

  return parsed.options
}

const compilerOptions = resolveCompilerOptions()
// Shared cache keeps one language service alive across all snippets.
const twoslashCache = new Map()
const tsLibDirectory = path.dirname(ts.getDefaultLibFilePath(compilerOptions))

export default defineEcConfig({
  plugins: [
    ecTwoSlash({
      twoslashOptions: {
        vfsRoot: codeRoot,
        cache: twoslashCache,
        tsModule: ts,
        tsLibDirectory,
        compilerOptions: {
          ...compilerOptions,
          noEmit: true,
        },
      },
    }),
  ],
})
