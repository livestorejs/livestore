/**
 * LiveStore base TypeScript configuration
 *
 * Uses ESNext target for maximum modern syntax support.
 * NodeNext module resolution for proper ESM handling.
 *
 * Effect Language Service plugin configuration:
 * - reportSuggestionsAsWarningsInTsc: show suggestions in tsc output
 * - pipeableMinArgCount: 2 - recommend pipe() for 2+ args
 * - schemaUnionOfLiterals: warning - prefer Schema.Literal union
 * - Note: missedPipeableOpportunity is disabled (too noisy)
 */

import { tsconfigJSON } from '#genie/mod.ts'

export default tsconfigJSON({
  compilerOptions: {
    paths: {
      '#genie/*': ['./submodules/effect-utils/packages/@overeng/genie/src/lib/*'],
    },
    strict: true,
    exactOptionalPropertyTypes: true,
    noUncheckedIndexedAccess: true,
    esModuleInterop: true,
    sourceMap: true,
    declarationMap: true,
    declaration: true,
    strictNullChecks: true,
    incremental: true,
    composite: true,
    allowJs: true,
    stripInternal: true,
    skipLibCheck: true,
    forceConsistentCasingInFileNames: true,
    noFallthroughCasesInSwitch: true,
    noErrorTruncation: true,
    isolatedModules: true,
    target: 'ESNext',
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    verbatimModuleSyntax: true,
    allowImportingTsExtensions: true,
    rewriteRelativeImportExtensions: true,
    erasableSyntaxOnly: true,
    plugins: [
      {
        name: '@effect/language-service',
        reportSuggestionsAsWarningsInTsc: true,
        pipeableMinArgCount: 2,
        diagnosticSeverity: {
          schemaUnionOfLiterals: 'warning',
        },
      },
    ],
  },
  exclude: ['packages/**/dist', 'node_modules', 'packages/**/node_modules', 'tests/**/node_modules'],
})
