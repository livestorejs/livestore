// @ts-check

import { defineEcConfig } from 'astro-expressive-code'
import ecTwoSlash from 'expressive-code-twoslash'
import ts from 'typescript'

export default defineEcConfig({
  plugins: [
    ecTwoSlash({
      twoslashOptions: {
        compilerOptions: {
          allowImportingTsExtensions: true,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          jsx: ts.JsxEmit.ReactJSX,
          exactOptionalPropertyTypes: true,
        },
      },
    }),
  ],
})
