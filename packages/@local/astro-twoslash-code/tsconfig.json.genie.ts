import { tsconfigJSON } from '../../../genie/repo.ts'

export default tsconfigJSON({
  extends: '../../../tsconfig.base.json',
  compilerOptions: {
    composite: true,
    rootDir: '.',
    outDir: './dist',
    types: ['node', 'astro'],
  },
  include: ['src', 'tests', 'examples'],
  exclude: ['dist', 'node_modules'],
})
