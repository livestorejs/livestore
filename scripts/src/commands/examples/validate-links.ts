import { Effect, Option, Schema } from '@livestore/utils/effect'
import { Cli } from '@livestore/utils/node'
import { type ExampleDeploymentEnvironment, exampleDeployments } from '@local/shared'

class ExampleLinkValidationError extends Schema.TaggedErrorClass<ExampleLinkValidationError>()(
  'ExampleLinkValidationError',
  {
    message: Schema.String,
  },
) {}

const environments = ['prod', 'dev'] as const satisfies readonly ExampleDeploymentEnvironment[]

const validateEndpoint = ({
  slug,
  environment,
  url,
  expectedStatus,
}: {
  slug: string
  environment: ExampleDeploymentEnvironment
  url: string
  expectedStatus: number
}) =>
  Effect.tryPromise({
    try: () => fetch(url, { method: 'GET', redirect: 'manual' }),
    catch: (cause) =>
      new ExampleLinkValidationError({
        message: `${slug} (${environment}) failed to fetch ${url}: ${String(cause)}`,
      }),
  }).pipe(
    Effect.flatMap((response) => {
      const status = Reflect.get(response, 'status')

      if (typeof status !== 'number') {
        return Effect.fail(
          new ExampleLinkValidationError({
            message: `${slug} (${environment}) did not expose a numeric HTTP status: ${url}`,
          }),
        )
      }

      if (status === expectedStatus) {
        return Effect.succeed({
          slug,
          environment,
          url,
          status,
        })
      }

      return Effect.fail(
        new ExampleLinkValidationError({
          message: `${slug} (${environment}) expected HTTP ${expectedStatus} but got ${status}: ${url}`,
        }),
      )
    }),
  )

export const validateLinksCommand = Cli.Command.make(
  'validate-links',
  {
    exampleFilter: Cli.Flag.text('example-filter').pipe(Cli.Flag.withAlias('e'), Cli.Flag.optional),
  },
  Effect.fn(function* ({ exampleFilter }) {
    const filteredDeployments = exampleDeployments.filter((deployment) =>
      Option.isSome(exampleFilter) === true ? deployment.slug.includes(exampleFilter.value) : true,
    )

    if (filteredDeployments.length === 0) {
      const available = exampleDeployments.map((deployment) => deployment.slug).join(', ')
      return yield* new ExampleLinkValidationError({
        message:
          Option.isSome(exampleFilter) === true
            ? `No example deployments match filter "${exampleFilter.value}". Available: ${available}`
            : 'No example deployments are configured.',
      })
    }

    const results = yield* Effect.forEach(
      filteredDeployments,
      (deployment) =>
        Effect.forEach(environments, (environment) =>
          validateEndpoint({
            slug: deployment.slug,
            environment,
            url: deployment.endpoints[environment].url,
            expectedStatus: deployment.endpoints[environment].expectedStatus,
          }),
        ),
      { concurrency: 4 },
    )

    for (const result of results.flat()) {
      console.log(`${result.status} ${result.slug} ${result.environment} ${result.url}`)
    }
  }),
)
