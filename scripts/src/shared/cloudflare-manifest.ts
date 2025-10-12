import { Schema } from '@livestore/utils/effect'

export const CloudflareDomainSchema = Schema.Struct({
  /** Apex domain managed in DNS (e.g. `livestore.dev`). */
  domain: Schema.String,
  /** Host label to bind under the apex (e.g. `web-todomvc` or `dev.web-todomvc`). */
  name: Schema.String,
  /** Which environment the domain represents so deploy + DNS can scope correctly. */
  scope: Schema.Literal('prod', 'dev'),
})

export type CloudflareDomain = typeof CloudflareDomainSchema.Type

export const CloudflareExampleSchema = Schema.Struct({
  /**
   * Machine-friendly identifier used by CLI filters (e.g. `web-todomvc`).
   * Matches the folder name under `examples/`.
   */
  slug: Schema.String,
  /**
   * Cloudflare Worker name prefix. The deploy command appends `-dev` or a preview suffix when needed.
   * Example: `example-web-todomvc`.
   */
  workerName: Schema.String,
  /** Path from repo root to the example (used as `cwd` for build/deploy). */
  repoRelativePath: Schema.String,
  /** Subfolder under `dist/` where the worker build (including `wrangler.json`) lands. */
  buildOutputDir: Schema.String,
  /**
   * Durable Object class names exported by the Worker so migrations and bindings stay in sync.
   * Example: `['SyncBackendDO']`.
   */
  durableObjects: Schema.Array(Schema.String),
  /**
   * Aliases used to derive environment names. `prod` typically matches the Worker name,
   * while `dev` gets `-dev` appended. Preview deployments reuse `prod`.
   */
  aliases: Schema.Struct({
    prod: Schema.String,
    dev: Schema.String,
  }),
  /**
   * List of DNS domains that should point at the Worker. Prod/dev scopes are filtered
   * based on the deploy target so the DNS command updates the right records.
   */
  domains: Schema.Array(CloudflareDomainSchema),
})

export type CloudflareExample = typeof CloudflareExampleSchema.Type

/**
 * Manifest describing how each example maps to Cloudflare Workers and domains.
 * Used by the examples deploy workflow to orchestrate builds, deploys, and DNS updates.
 */
export const cloudflareExamples: readonly CloudflareExample[] = [
  {
    slug: 'cf-chat',
    workerName: 'example-cf-chat',
    repoRelativePath: 'examples/cf-chat',
    buildOutputDir: 'example_cf_chat',
    durableObjects: ['SyncBackendDO', 'LiveStoreClientDO'],
    aliases: {
      prod: 'prod',
      dev: 'dev',
    },
    domains: [
      { domain: 'livestore.dev', name: 'cf-chat', scope: 'prod' },
      { domain: 'livestore.dev', name: 'dev.cf-chat', scope: 'dev' },
    ],
  },
  {
    slug: 'web-linearlite',
    workerName: 'example-web-linearlite',
    repoRelativePath: 'examples/web-linearlite',
    buildOutputDir: 'server',
    durableObjects: ['SyncBackendDO'],
    aliases: {
      prod: 'prod',
      dev: 'dev',
    },
    domains: [
      { domain: 'livestore.dev', name: 'web-linearlite', scope: 'prod' },
      { domain: 'livestore.dev', name: 'dev.web-linearlite', scope: 'dev' },
    ],
  },
  {
    slug: 'web-todomvc',
    workerName: 'example-web-todomvc',
    repoRelativePath: 'examples/web-todomvc',
    buildOutputDir: 'example_web_todomvc',
    durableObjects: [],
    aliases: {
      prod: 'prod',
      dev: 'dev',
    },
    domains: [
      { domain: 'livestore.dev', name: 'web-todomvc', scope: 'prod' },
      { domain: 'livestore.dev', name: 'dev.web-todomvc', scope: 'dev' },
    ],
  },
  {
    slug: 'web-todomvc-custom-elements',
    workerName: 'example-web-todomvc-custom-elements',
    repoRelativePath: 'examples/web-todomvc-custom-elements',
    buildOutputDir: 'example_web_todomvc_custom_elements',
    durableObjects: [],
    aliases: {
      prod: 'prod',
      dev: 'dev',
    },
    domains: [
      { domain: 'livestore.dev', name: 'web-todomvc-custom-elements', scope: 'prod' },
      { domain: 'livestore.dev', name: 'dev.web-todomvc-custom-elements', scope: 'dev' },
    ],
  },
  {
    slug: 'web-todomvc-experimental',
    workerName: 'example-web-todomvc-experimental',
    repoRelativePath: 'examples/web-todomvc-experimental',
    buildOutputDir: 'example_web_todomvc_experimental',
    durableObjects: [],
    aliases: {
      prod: 'prod',
      dev: 'dev',
    },
    domains: [
      { domain: 'livestore.dev', name: 'web-todomvc-experimental', scope: 'prod' },
      { domain: 'livestore.dev', name: 'dev.web-todomvc-experimental', scope: 'dev' },
    ],
  },
  {
    slug: 'web-todomvc-script',
    workerName: 'example-web-todomvc-script',
    repoRelativePath: 'examples/web-todomvc-script',
    buildOutputDir: 'example_web_todomvc_script',
    durableObjects: [],
    aliases: {
      prod: 'prod',
      dev: 'dev',
    },
    domains: [
      { domain: 'livestore.dev', name: 'web-todomvc-script', scope: 'prod' },
      { domain: 'livestore.dev', name: 'dev.web-todomvc-script', scope: 'dev' },
    ],
  },
  {
    slug: 'web-todomvc-solid',
    workerName: 'example-web-todomvc-solid',
    repoRelativePath: 'examples/web-todomvc-solid',
    buildOutputDir: 'example_web_todomvc_solid',
    durableObjects: [],
    aliases: {
      prod: 'prod',
      dev: 'dev',
    },
    domains: [
      { domain: 'livestore.dev', name: 'web-todomvc-solid', scope: 'prod' },
      { domain: 'livestore.dev', name: 'dev.web-todomvc-solid', scope: 'dev' },
    ],
  },
  {
    slug: 'web-todomvc-sync-cf',
    workerName: 'example-web-todomvc-sync-cf',
    repoRelativePath: 'examples/web-todomvc-sync-cf',
    buildOutputDir: 'example_web_todomvc_sync_cf',
    durableObjects: ['SyncBackendDO'],
    aliases: {
      prod: 'prod',
      dev: 'dev',
    },
    domains: [
      { domain: 'livestore.dev', name: 'web-todomvc-sync-cf', scope: 'prod' },
      { domain: 'livestore.dev', name: 'dev.web-todomvc-sync-cf', scope: 'dev' },
    ],
  },
]

export const cloudflareExamplesBySlug = new Map(cloudflareExamples.map((example) => [example.slug, example]))
