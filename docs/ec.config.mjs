// @ts-check

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineEcConfig } from 'astro-expressive-code'
import ecTwoSlash from 'expressive-code-twoslash'
import ts from 'typescript'

// Twoslash should see the same workspace layout as the snippet sources.
const codeRoot = fileURLToPath(new URL('./src/content/_assets/code/', import.meta.url))
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
