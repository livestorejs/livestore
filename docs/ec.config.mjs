// @ts-check

import { defineEcConfig } from 'astro-expressive-code'
import ecTwoSlash from 'expressive-code-twoslash'
import ts from 'typescript'

export default defineEcConfig({
  plugins: [
    ecTwoSlash({
      twoslashOptions: {
        compilerOptions: {
          // Use exactly the same strict settings as tsconfig.base.json
          strict: true,
          exactOptionalPropertyTypes: true,
          noUncheckedIndexedAccess: true,
          strictNullChecks: true,
          noFallthroughCasesInSwitch: true,
          forceConsistentCasingInFileNames: true,
          isolatedModules: true,
          noErrorTruncation: true,

          // Module/import settings (match docs tsconfig.json)
          allowImportingTsExtensions: true,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          module: ts.ModuleKind.ESNext,
          verbatimModuleSyntax: true,
          esModuleInterop: true,
          allowJs: true,
          rewriteRelativeImportExtensions: true,
          erasableSyntaxOnly: true,

          // Build settings
          target: ts.ScriptTarget.ESNext,
          jsx: ts.JsxEmit.ReactJSX,
          skipLibCheck: true,
          resolveJsonModule: true,
        },
      },
    }),
  ],
})
