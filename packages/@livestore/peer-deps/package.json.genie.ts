import { catalog, livestorePackageDefaults, packageJson, workspaceMember } from '../../../genie/repo.ts'

const runtimeDeps = catalog.compose({
  workspace: workspaceMember('packages/@livestore/peer-deps'),
  dependencies: {
    external: catalog.pick(
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
      '@standard-schema/spec',
      'effect',
    ),
  },
})

export default packageJson(
  {
    name: '@livestore/peer-deps',
    ...livestorePackageDefaults,
    description:
      'This is a convenience package that can be installed to satisfy peer dependencies of Livestore packages.',
    files: ['package.json'],
    publishConfig: {
      access: 'public',
    },
    scripts: {
      test: "echo 'No tests for peer-deps'",
    },
  },
  runtimeDeps,
)
