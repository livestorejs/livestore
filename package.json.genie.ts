import {
  onlyBuiltDependencies,
  overrides,
  patchedDependencies,
  pkg,
  workspaceResolutions,
} from './genie/repo.ts'

export default pkg.root({
  name: '@livestore/monorepo',
  version: '0.0.0',
  private: true,
  type: 'module',
  imports: {
    '#genie/*': './submodules/effect-utils/packages/@overeng/genie/src/lib/*',
  },
  devDependencies: [
    '@biomejs/biome',
    '@effect/language-service',
    '@types/node',
    '@vitest/ui',
    'husky',
    'madge',
    'typescript',
    'vite',
    'vitest',
    'yaml',
  ],
  pnpm: {
    patchedDependencies,
    onlyBuiltDependencies,
    overrides,
  },
  resolutions: workspaceResolutions,
  scripts: {
    '_build:ts': 'tsc --build tsconfig.dev.json && tsc --build tsconfig.examples.json',
    'build': 'pnpm run build:ts',
    'build:clean': 'bash -c "find {examples,packages,tests,docs} -path \'*node_modules*\' -prune -o \\( -name \'dist\' -type d -o -name \'*.tsbuildinfo\' \\) -exec rm -rf {} +"',
    'build:ts': 'tsc --build tsconfig.dev.json',
    'pack:tmp': "pnpm --filter '@livestore/*' exec -- pnpm pack --out tmp/pack.tgz",
    'prepare': 'husky && effect-language-service patch || true',
    'test': 'CI=1 pnpm --parallel run test',
    'update-lockfile': 'CI=1 pnpm install --lockfile-only',
  },
})
