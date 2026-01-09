import { livestorePackageDefaults, pkg } from '../../../genie/repo.ts'

export default pkg({
  name: '@livestore/peer-deps',
  dependencies: [
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
  ],
  description:
    'This is a convenience package that can be installed to satisfy peer dependencies of Livestore packages.',
  ...livestorePackageDefaults,
  files: ['package.json'],
  publishConfig: {
    access: 'public',
  },
  scripts: {
    test: "echo 'No tests for peer-deps'",
  },
})
