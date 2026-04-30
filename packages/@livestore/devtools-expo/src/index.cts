// eslint-disable-next-line unicorn/prefer-module, @typescript-eslint/no-require-imports
// biome-ignore lint/correctness/useImportExtensions: TypeScript's rewriteRelativeImportExtensions doesn't rewrite require() calls, so we need to use the output extension directly
module.exports = require('./metro-config.cjs')

export type * from './metro-config.cts'
