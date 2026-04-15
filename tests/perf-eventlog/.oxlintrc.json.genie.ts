import {
  livestoreOxlintCategories,
  livestoreOxlintIgnorePatterns,
  livestoreOxlintOverrides,
  livestoreOxlintPlugins,
  livestoreOxlintRules,
} from '../../.oxlintrc.json.genie.ts'
import { oxlintConfig } from '../../repos/effect-utils/genie/external.ts'

export default oxlintConfig({
  plugins: livestoreOxlintPlugins,
  categories: livestoreOxlintCategories,
  rules: livestoreOxlintRules,
  overrides: livestoreOxlintOverrides,
  ignorePatterns: [
    ...livestoreOxlintIgnorePatterns,
    'node_modules/**',
    'dist/**',
    '.cache/**',
    '.pnpm/**',
  ],
})
