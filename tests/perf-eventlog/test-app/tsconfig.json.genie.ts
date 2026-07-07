import { domLib, tsconfigJson } from '../../../genie/repo.ts'
import baseTsconfig from '../tsconfig.json.genie.ts'

export default tsconfigJson({
  ...baseTsconfig.data,
  compilerOptions: {
    ...baseTsconfig.data.compilerOptions,
    lib: [...domLib],
    types: ['vite/client'],
  },
  include: ['./src', './vite.config.ts', './index.html', '../src'],
  references: baseTsconfig.data.references.map((reference) => ({ ...reference, path: `../${reference.path}` })),
})
