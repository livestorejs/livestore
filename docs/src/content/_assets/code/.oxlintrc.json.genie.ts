import { oxlintConfig } from '#mr/effect-utils/genie/external.ts'

import {
  livestoreOxlintCategories,
  livestoreOxlintIgnorePatterns,
  livestoreOxlintOverrides,
  livestoreOxlintPlugins,
  livestoreOxlintRules,
} from '../../../../../.oxlintrc.json.genie.ts'

export default oxlintConfig({
  plugins: livestoreOxlintPlugins,
  categories: livestoreOxlintCategories,
  rules: {
    ...livestoreOxlintRules,
    'import/no-commonjs': 'off',
  },
  overrides: livestoreOxlintOverrides,
  ignorePatterns: [...livestoreOxlintIgnorePatterns, 'node_modules/**', 'dist/**', '.cache/**', '.pnpm/**'],
})
