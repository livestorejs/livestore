import { oxfmtConfig } from '../../../genie/repo.ts'

export default oxfmtConfig({
  semi: false,
  singleQuote: true,
  printWidth: 120,
  tabWidth: 2,
  useTabs: false,
  trailingComma: 'all',
  /** Import sorting configuration
   * Groups imports into 3 blocks separated by newlines:
   * 1. External packages (effect, @effect/*)
   * 2. Internal monorepo packages (@livestore/*, @local/*)
   * 3. Relative imports (parent, sibling, index)
   */
  experimentalSortImports: {
    groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index']],
    internalPattern: ['@livestore/', '@local/'],
    newlinesBetween: true,
  },
  experimentalSortPackageJson: true,
  /** Ignore generated files (pattern-based excludes)
   * Note: Genie-generated read-only files are excluded via inline args in mono CLI
   */
  ignorePatterns: ['**/*.gen.ts', '**/*.gen.tsx', '**/*.generated.ts', '**/*.generated.tsx'],
})
