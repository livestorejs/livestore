export type ExampleDeploymentEnvironment = 'prod' | 'dev'

export interface ExampleDeploymentEndpoint {
  url: string
  /**
   * Validate without following redirects so route-level regressions stay visible.
   * LinearLite intentionally redirects from `/` into a generated store route.
   */
  expectedStatus: number
}

export interface ExampleDeployment {
  slug: string
  sourcePath: `examples/${string}`
  workerName: string
  endpoints: Record<ExampleDeploymentEnvironment, ExampleDeploymentEndpoint>
}

export const exampleDeployments = [
  {
    slug: 'web-todomvc',
    sourcePath: 'examples/web-todomvc',
    workerName: 'example-web-todomvc',
    endpoints: {
      prod: { url: 'https://example-web-todomvc.livestore.workers.dev', expectedStatus: 200 },
      dev: { url: 'https://example-web-todomvc-dev.livestore.workers.dev', expectedStatus: 200 },
    },
  },
  {
    slug: 'web-linearlite',
    sourcePath: 'examples/web-linearlite',
    workerName: 'example-web-linearlite',
    endpoints: {
      prod: { url: 'https://example-web-linearlite.livestore.workers.dev', expectedStatus: 307 },
      dev: { url: 'https://example-web-linearlite-dev.livestore.workers.dev', expectedStatus: 307 },
    },
  },
  {
    slug: 'web-todomvc-sync-cf',
    sourcePath: 'examples/web-todomvc-sync-cf',
    workerName: 'example-web-todomvc-sync-cf',
    endpoints: {
      prod: { url: 'https://example-web-todomvc-sync-cf.livestore.workers.dev', expectedStatus: 200 },
      dev: { url: 'https://example-web-todomvc-sync-cf-dev.livestore.workers.dev', expectedStatus: 200 },
    },
  },
] as const satisfies readonly ExampleDeployment[]

export type ExampleDeploymentSlug = (typeof exampleDeployments)[number]['slug']

export const exampleDeploymentsBySlug = Object.fromEntries(
  exampleDeployments.map((deployment) => [deployment.slug, deployment]),
) as Record<ExampleDeploymentSlug, (typeof exampleDeployments)[number]>

export const getExampleDeployment = <TSlug extends ExampleDeploymentSlug>(slug: TSlug) => exampleDeploymentsBySlug[slug]
