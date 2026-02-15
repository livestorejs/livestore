import { catalog, livestorePackageDefaults, packageJson } from '../../../genie/repo.ts'

export default packageJson({
  name: '@livestore/peer-deps',
  ...livestorePackageDefaults,
  dependencies: {
    ...catalog.pick(
      '@effect/ai',
      '@effect/cli',
      '@effect/cluster',
      '@effect/experimental',
      '@effect/opentelemetry',
      '@effect/platform',
      '@effect/platform-browser',
      '@effect/platform-bun',
      '@effect/platform-node',
      '@effect/printer',
      '@effect/printer-ansi',
      '@effect/rpc',
      '@effect/sql',
      '@effect/typeclass',
      '@opentelemetry/api',
      '@opentelemetry/resources',
      'effect',
    ),
  },
  description:
    'This is a convenience package that can be installed to satisfy peer dependencies of Livestore packages.',
  files: ['package.json'],
  publishConfig: {
    access: 'public',
  },
  scripts: {
    test: "echo 'No tests for peer-deps'",
  },
})
